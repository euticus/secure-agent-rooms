import {
  DEFAULT_BUDGET,
  ParticipantPolicy,
  TaskContract,
  canTransition,
  hashToken,
  newId,
  newSecretToken,
  type ExecutionBudget,
  type RoomState,
} from "@booth/shared";
import type { Invite, Room, RoomParticipant } from "@booth/database";
import type { Ctx } from "./context.js";
import { AppError, forbidden, notFound } from "./errors.js";
import { requireMembership, requireRoomAccess } from "./authz.js";
import { audit, checkpointAudit } from "./audit.js";
import { getOwnedAgentConnection } from "./identity.js";
import { notifySecurityAlert } from "./notifications.js";

export async function createRoom(
  ctx: Ctx,
  userId: string,
  input: {
    organizationId: string;
    name: string;
    description?: string;
    budget?: Partial<ExecutionBudget>;
    contentRetentionDays?: number;
    auditRetentionDays?: number;
  },
): Promise<{ room: Room; participant: RoomParticipant }> {
  await requireMembership(ctx, userId, input.organizationId, { admin: true });
  const now = ctx.clock.now().toISOString();
  const room: Room = {
    id: newId("room"),
    name: input.name,
    description: input.description ?? "",
    createdByUserId: userId,
    creatorOrgId: input.organizationId,
    state: "DRAFT",
    budget: { ...DEFAULT_BUDGET, ...input.budget },
    usage: { turns: 0, toolCalls: 0, modelSpendUsd: 0, startedAtMs: null },
    contentRetentionDays: input.contentRetentionDays ?? 7,
    auditRetentionDays: input.auditRetentionDays ?? 365,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    closedAt: null,
  };
  await ctx.store.createRoom(room);
  const participant: RoomParticipant = {
    id: newId("part"),
    roomId: room.id,
    organizationId: input.organizationId,
    role: "customer",
    agentConnectionId: null,
    policy: null,
    contractApprovedVersion: null,
    completionApprovedByUserId: null,
    joinedAt: now,
  };
  await ctx.store.createParticipant(participant);
  await audit(ctx, {
    action: "ROOM_CREATED",
    actorType: "user",
    actorId: userId,
    organizationId: input.organizationId,
    roomId: room.id,
  });
  return { room, participant };
}

async function transition(ctx: Ctx, room: Room, to: RoomState, actor: { userId?: string }): Promise<Room> {
  if (!canTransition(room.state, to)) {
    throw new AppError("STATE", `cannot transition room from ${room.state} to ${to}`);
  }
  const updated = { ...room, state: to };
  await ctx.store.updateRoom(updated);
  await audit(ctx, {
    action: `ROOM_STATE_${to}`,
    actorType: actor.userId ? "user" : "system",
    actorId: actor.userId ?? null,
    roomId: room.id,
    metadata: { from: room.state, to },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Invites (spec §12)
// ---------------------------------------------------------------------------

export async function createInvite(
  ctx: Ctx,
  userId: string,
  roomId: string,
  input: { targetEmail?: string; targetDomain?: string; expiresInHours?: number },
): Promise<{ invite: Invite; token: string }> {
  const { room, membership } = await requireRoomAccess(ctx, userId, roomId, { admin: true });
  if (room.state !== "DRAFT" && room.state !== "INVITED") {
    throw new AppError("STATE", `cannot invite in room state ${room.state}`);
  }
  const token = newSecretToken(); // 256 bits; returned once, only the hash is stored
  const invite: Invite = {
    id: newId("inv"),
    roomId,
    invitingOrgId: membership.organizationId,
    targetEmail: input.targetEmail ?? null,
    targetDomain: input.targetDomain ?? null,
    tokenHash: hashToken(token),
    expiresAt: new Date(
      ctx.clock.now().getTime() + (input.expiresInHours ?? 72) * 3600_000,
    ).toISOString(),
    redeemedAt: null,
    redeemedByUserId: null,
    revokedAt: null,
    maxRedemptions: 1,
    redemptions: 0,
    createdByUserId: userId,
    createdAt: ctx.clock.now().toISOString(),
  };
  await ctx.store.createInvite(invite);
  if (room.state === "DRAFT") await transition(ctx, room, "INVITED", { userId });
  await audit(ctx, {
    action: "INVITE_CREATED",
    actorType: "user",
    actorId: userId,
    organizationId: membership.organizationId,
    roomId,
    resource: invite.id,
  });
  return { invite, token };
}

/**
 * Preview an invitation. The token grants permission to view and respond to
 * the invitation — NOT room contents. Requires authentication.
 */
export async function previewInvite(ctx: Ctx, userId: string, token: string) {
  const invite = await loadRedeemableInvite(ctx, userId, token);
  const room = await ctx.store.getRoom(invite.roomId);
  if (!room) throw notFound("invite");
  const invitingOrg = await ctx.store.getOrganization(invite.invitingOrgId);
  const contract = await ctx.store.latestContractVersion(invite.roomId);
  return {
    inviteId: invite.id,
    roomName: room.name,
    roomDescription: room.description,
    invitingOrganization: invitingOrg?.name ?? "unknown",
    expiresAt: invite.expiresAt,
    // Authorization summary only — never room events.
    contractSummary: contract
      ? {
          objective: contract.contract.objective,
          permittedDataClasses: contract.contract.permittedDataClasses,
          forbiddenDataClasses: contract.contract.forbiddenDataClasses,
          approvalRequiredActions: contract.contract.approvalRequiredActions,
        }
      : null,
  };
}

async function loadRedeemableInvite(ctx: Ctx, userId: string, token: string): Promise<Invite> {
  const invite = await ctx.store.getInviteByTokenHash(hashToken(token));
  if (!invite) throw notFound("invite");
  const now = ctx.clock.now().getTime();
  if (invite.revokedAt) throw new AppError("STATE", "invite revoked");
  if (new Date(invite.expiresAt).getTime() < now) throw new AppError("STATE", "invite expired");
  if (invite.redemptions >= invite.maxRedemptions) throw new AppError("STATE", "invite already redeemed");
  const user = await ctx.store.getUser(userId);
  if (!user) throw forbidden();
  if (invite.targetEmail && invite.targetEmail.toLowerCase() !== user.email.toLowerCase()) {
    throw forbidden("invite is bound to a different email address");
  }
  if (invite.targetDomain) {
    const domain = user.email.split("@")[1]?.toLowerCase();
    if (domain !== invite.targetDomain.toLowerCase()) {
      throw forbidden("invite is bound to a different email domain");
    }
  }
  return invite;
}

export async function redeemInvite(
  ctx: Ctx,
  userId: string,
  token: string,
  organizationId: string,
): Promise<RoomParticipant> {
  // Redemption requires an authenticated member of the joining org.
  await requireMembership(ctx, userId, organizationId, { admin: true });
  const invite = await loadRedeemableInvite(ctx, userId, token);
  const room = await ctx.store.getRoom(invite.roomId);
  if (!room) throw notFound("invite");
  if (organizationId === invite.invitingOrgId) {
    throw new AppError("VALIDATION", "cannot redeem an invite for the inviting organization");
  }
  const existing = await ctx.store.listParticipants(room.id);
  if (existing.some((p) => p.organizationId === organizationId)) {
    throw new AppError("CONFLICT", "organization already participates in this room");
  }
  if (existing.length >= 2) throw new AppError("CONFLICT", "room is full");

  const updatedInvite: Invite = {
    ...invite,
    redemptions: invite.redemptions + 1,
    redeemedAt: ctx.clock.now().toISOString(),
    redeemedByUserId: userId,
  };
  await ctx.store.updateInvite(updatedInvite);

  const participant: RoomParticipant = {
    id: newId("part"),
    roomId: room.id,
    organizationId,
    role: "provider",
    agentConnectionId: null,
    policy: null,
    contractApprovedVersion: null,
    completionApprovedByUserId: null,
    joinedAt: ctx.clock.now().toISOString(),
  };
  await ctx.store.createParticipant(participant);
  await transition(ctx, room, "NEGOTIATING", { userId });
  await audit(ctx, {
    action: "INVITE_REDEEMED",
    actorType: "user",
    actorId: userId,
    organizationId,
    roomId: room.id,
    resource: invite.id,
  });
  await audit(ctx, {
    action: "PARTICIPANT_JOINED",
    actorType: "user",
    actorId: userId,
    organizationId,
    roomId: room.id,
    resource: participant.id,
  });
  return participant;
}

// ---------------------------------------------------------------------------
// Task contract (spec §14)
// ---------------------------------------------------------------------------

export async function proposeContract(
  ctx: Ctx,
  userId: string,
  roomId: string,
  contractInput: unknown,
) {
  const { room } = await requireRoomAccess(ctx, userId, roomId, { admin: true });
  if (!["DRAFT", "INVITED", "NEGOTIATING"].includes(room.state)) {
    throw new AppError("STATE", `cannot edit contract in room state ${room.state}`);
  }
  const contract = TaskContract.parse(contractInput);
  const latest = await ctx.store.latestContractVersion(roomId);
  const version = (latest?.version ?? 0) + 1;
  await ctx.store.createContractVersion({
    id: newId("tcv"),
    roomId,
    version,
    contract,
    createdByUserId: userId,
    createdAt: ctx.clock.now().toISOString(),
  });
  // A new version voids all previous approvals — never silently expand scope.
  for (const p of await ctx.store.listParticipants(roomId)) {
    if (p.contractApprovedVersion !== null) {
      await ctx.store.updateParticipant({ ...p, contractApprovedVersion: null });
    }
  }
  await audit(ctx, {
    action: "CONTRACT_PROPOSED",
    actorType: "user",
    actorId: userId,
    roomId,
    metadata: { version },
  });
  return { version, contract };
}

export async function approveContract(ctx: Ctx, userId: string, roomId: string, version: number) {
  const { room, participant } = await requireRoomAccess(ctx, userId, roomId, { admin: true });
  const latest = await ctx.store.latestContractVersion(roomId);
  if (!latest) throw new AppError("STATE", "no contract to approve");
  if (latest.version !== version) {
    throw new AppError("CONFLICT", `contract has changed (latest is v${latest.version}); re-review required`);
  }
  await ctx.store.updateParticipant({ ...participant, contractApprovedVersion: version });
  await audit(ctx, {
    action: "POLICY_APPROVED",
    actorType: "user",
    actorId: userId,
    organizationId: participant.organizationId,
    roomId,
    metadata: { contractVersion: version },
  });
  await maybeMarkReady(ctx, roomId, userId);
}

export async function setParticipantPolicy(
  ctx: Ctx,
  userId: string,
  roomId: string,
  policyInput: unknown,
) {
  const { room, participant } = await requireRoomAccess(ctx, userId, roomId, { admin: true });
  if (["ACTIVE", "COMPLETION_PROPOSED", "COMPLETED", "CLOSED", "CANCELED"].includes(room.state)) {
    // Live policy changes require pausing first — never silent expansion mid-run.
    throw new AppError("STATE", `cannot change policy in room state ${room.state}; pause the room first`);
  }
  const policy = ParticipantPolicy.parse(policyInput);
  await ctx.store.updateParticipant({ ...participant, policy });
  await audit(ctx, {
    action: "POLICY_CHANGED",
    actorType: "user",
    actorId: userId,
    organizationId: participant.organizationId,
    roomId,
  });
  await maybeMarkReady(ctx, roomId, userId);
  return policy;
}

export async function connectAgentToRoom(
  ctx: Ctx,
  userId: string,
  roomId: string,
  agentConnectionId: string,
) {
  const { participant } = await requireRoomAccess(ctx, userId, roomId, { admin: true });
  // The connection must belong to the caller's own organization.
  await getOwnedAgentConnection(ctx, participant.organizationId, agentConnectionId);
  await ctx.store.updateParticipant({ ...participant, agentConnectionId });
  await audit(ctx, {
    action: "AGENT_CONNECTED",
    actorType: "user",
    actorId: userId,
    organizationId: participant.organizationId,
    roomId,
    resource: agentConnectionId,
  });
  await maybeMarkReady(ctx, roomId, userId);
}

async function maybeMarkReady(ctx: Ctx, roomId: string, userId: string) {
  const room = await ctx.store.getRoom(roomId);
  if (!room || room.state !== "NEGOTIATING") return;
  const latest = await ctx.store.latestContractVersion(roomId);
  if (!latest) return;
  const participants = await ctx.store.listParticipants(roomId);
  const ready =
    participants.length === 2 &&
    participants.every(
      (p) =>
        p.contractApprovedVersion === latest.version &&
        p.policy !== null &&
        p.agentConnectionId !== null,
    );
  if (ready) await transition(ctx, room, "READY", { userId });
}

// ---------------------------------------------------------------------------
// Lifecycle (spec §13, §39)
// ---------------------------------------------------------------------------

export async function startRoom(ctx: Ctx, userId: string, roomId: string) {
  const { room } = await requireRoomAccess(ctx, userId, roomId, { admin: true });
  if (room.state !== "READY") throw new AppError("STATE", `room is ${room.state}, not READY`);
  const updated = await transition(ctx, room, "ACTIVE", { userId });
  const started = {
    ...updated,
    startedAt: ctx.clock.now().toISOString(),
    usage: { ...updated.usage, startedAtMs: ctx.clock.now().getTime() },
  };
  await ctx.store.updateRoom(started);
  await audit(ctx, { action: "ROOM_STARTED", actorType: "user", actorId: userId, roomId });
  return started;
}

export async function pauseRoom(ctx: Ctx, userId: string, roomId: string) {
  const { room } = await requireRoomAccess(ctx, userId, roomId, { admin: true });
  return transition(ctx, room, "PAUSED", { userId });
}

export async function resumeRoom(ctx: Ctx, userId: string, roomId: string) {
  const { room } = await requireRoomAccess(ctx, userId, roomId, { admin: true });
  return transition(ctx, room, "ACTIVE", { userId });
}

export async function cancelRoom(ctx: Ctx, userId: string, roomId: string) {
  const { room } = await requireRoomAccess(ctx, userId, roomId, { admin: true });
  return transition(ctx, room, "CANCELED", { userId });
}

/** Room closure (spec §39): stop execution, void approvals, finalize audit. */
export async function closeRoom(ctx: Ctx, userId: string, roomId: string) {
  const { room } = await requireRoomAccess(ctx, userId, roomId, { admin: true });
  let current = room;
  if (!["COMPLETED", "CANCELED", "QUARANTINED"].includes(current.state)) {
    current = await transition(ctx, current, "CANCELED", { userId });
  }
  const closed = { ...current, state: "CLOSED" as RoomState, closedAt: ctx.clock.now().toISOString() };
  if (!canTransition(current.state, "CLOSED")) {
    throw new AppError("STATE", `cannot close room from ${current.state}`);
  }
  await ctx.store.updateRoom(closed);

  // Invalidate outstanding approvals.
  for (const a of await ctx.store.listApprovals(roomId)) {
    if (a.status === "PENDING") {
      await ctx.store.updateApproval({ ...a, status: "INVALIDATED" });
    }
  }
  // Revoke outstanding invites.
  for (const inv of await ctx.store.listInvites(roomId)) {
    if (!inv.revokedAt && !inv.redeemedAt) {
      await ctx.store.updateInvite({ ...inv, revokedAt: ctx.clock.now().toISOString() });
    }
  }
  await audit(ctx, { action: "ROOM_CLOSED", actorType: "user", actorId: userId, roomId });
  await checkpointAudit(ctx); // finalize the audit record with a signed checkpoint
  return closed;
}

export async function quarantineRoom(ctx: Ctx, roomId: string, reason: string) {
  const room = await ctx.store.getRoom(roomId);
  if (!room) throw notFound("room");
  if (!canTransition(room.state, "QUARANTINED")) return room;
  const updated = { ...room, state: "QUARANTINED" as RoomState };
  await ctx.store.updateRoom(updated);
  // Alerts are tenant-scoped: emit one per participant organization rather
  // than a null-org alert, which every tenant would otherwise be shown.
  for (const p of await ctx.store.listParticipants(roomId)) {
    const alertId = newId("alert");
    await ctx.store.createSecurityAlert({
      id: alertId,
      roomId,
      organizationId: p.organizationId,
      severity: "CRITICAL",
      kind: "room_quarantined",
      detail: reason,
      createdAt: ctx.clock.now().toISOString(),
    });
    // A quarantine stops the work; the people who can act on it need telling.
    await notifySecurityAlert(ctx, {
      alertId,
      roomId,
      roomName: room.name,
      organizationId: p.organizationId,
      severity: "CRITICAL",
      kind: "room_quarantined",
      detail: reason,
    });
  }
  await audit(ctx, {
    action: "SECURITY_ALERT",
    actorType: "system",
    roomId,
    decision: "quarantine",
    metadata: { reason },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Completion (spec §37–38)
// ---------------------------------------------------------------------------

export async function completionStatus(ctx: Ctx, roomId: string) {
  const latest = await ctx.store.latestContractVersion(roomId);
  if (!latest) {
    return { satisfied: false, verified: false, criteria: [] as { id: string; description: string; evidenceRequired: boolean; state: string }[] };
  }
  const statuses = await ctx.store.listCriterionStatuses(roomId);
  const criteria = latest.contract.completionCriteria.map((c) => {
    const s = statuses.find((x) => x.criterionId === c.id);
    return {
      id: c.id,
      description: c.description,
      evidenceRequired: c.evidenceRequired,
      state: s?.state ?? "PENDING",
    };
  });
  // `satisfied`: every evidence-required criterion has evidence (allows the
  // room to reach COMPLETION_PROPOSED). `verified`: a human has verified that
  // evidence — required before COMPLETED, since agent claims are never
  // auto-verified (spec §37).
  const satisfied = criteria.every((c) => !c.evidenceRequired || c.state !== "PENDING");
  const verified = criteria.every((c) => !c.evidenceRequired || c.state === "VERIFIED");
  return { satisfied, verified, criteria };
}

/** Dual human approval: both organizations must approve before COMPLETED. */
export async function approveCompletion(ctx: Ctx, userId: string, roomId: string) {
  const { room, participant } = await requireRoomAccess(ctx, userId, roomId, { admin: true });
  if (room.state !== "COMPLETION_PROPOSED") {
    throw new AppError("STATE", `room is ${room.state}; completion has not been proposed`);
  }
  const { satisfied, verified } = await completionStatus(ctx, roomId);
  if (!satisfied) throw new AppError("STATE", "completion criteria are not satisfied");
  // A human must have verified the evidence — an agent's CLAIMED evidence alone
  // cannot carry a room to COMPLETED (spec §37).
  if (!verified) {
    throw new AppError("STATE", "evidence for one or more criteria has not been human-verified");
  }
  await ctx.store.updateParticipant({ ...participant, completionApprovedByUserId: userId });
  await audit(ctx, {
    action: "COMPLETION_APPROVED",
    actorType: "user",
    actorId: userId,
    organizationId: participant.organizationId,
    roomId,
  });
  const participants = await ctx.store.listParticipants(roomId);
  if (participants.every((p) => p.completionApprovedByUserId !== null)) {
    const completed = {
      ...(await ctx.store.getRoom(roomId))!,
      state: "COMPLETED" as RoomState,
      completedAt: ctx.clock.now().toISOString(),
    };
    await ctx.store.updateRoom(completed);
    await audit(ctx, { action: "ROOM_COMPLETED", actorType: "system", roomId });
    return completed;
  }
  return ctx.store.getRoom(roomId);
}
