import { ROOM_TEMPLATES, findTemplate, type ExecutionBudget } from "@booth/shared";
import type { Room } from "@booth/database";
import type { Ctx } from "./context.js";
import { AppError, notFound } from "./errors.js";
import { requireMembership, requireRoomAccess } from "./authz.js";
import {
  approveContract,
  connectAgentToRoom,
  createInvite,
  createRoom,
  proposeContract,
  redeemInvite,
  setParticipantPolicy,
} from "./rooms.js";
import { notifyInvitation } from "./notifications.js";

/**
 * Guided onboarding.
 *
 * Getting two companies from "signed up" to "agents working" involved roughly
 * fifteen separate steps across two organizations, which is where new users
 * gave up. These two operations collapse that into one action per side:
 *
 *   launchRoom()      — the inviting side: template -> contract -> policy ->
 *                       agent -> approval -> invitation email, in one call.
 *   acceptInvitation() — the invited side: join -> policy -> agent -> approve,
 *                       in one call, leaving the room READY.
 *
 * Nothing here bypasses a control: both sides still approve the identical
 * contract version, and every default is a normal policy the user can edit.
 */

export { ROOM_TEMPLATES };

export interface LaunchRoomInput {
  organizationId: string;
  templateId: string;
  name: string;
  /** Overrides the template's objective when supplied. */
  objective?: string;
  /** When present, the invitation is emailed here and bound to this address. */
  counterpartEmail?: string;
  personalNote?: string;
  agentConnectionId?: string;
  budget?: Partial<ExecutionBudget>;
}

export interface LaunchRoomResult {
  room: Room;
  inviteToken: string;
  inviteUrl: string;
  invitationEmailed: boolean;
  /** Anything the caller still has to do before the room can start. */
  remaining: string[];
}

export async function launchRoom(
  ctx: Ctx,
  userId: string,
  input: LaunchRoomInput,
): Promise<LaunchRoomResult> {
  await requireMembership(ctx, userId, input.organizationId, { admin: true });
  const template = findTemplate(input.templateId);
  if (!template) throw new AppError("VALIDATION", `unknown template "${input.templateId}"`);

  const org = await ctx.store.getOrganization(input.organizationId);
  if (!org) throw notFound("organization");

  const { room } = await createRoom(ctx, userId, {
    organizationId: input.organizationId,
    name: input.name,
    description: template.summary,
    budget: input.budget,
  });

  // Contract: the template, with this organization named as the customer.
  // Every field must be valid even for the blank template, so a room launched
  // from scratch is immediately editable rather than immediately broken.
  const objective = (input.objective ?? template.objective).trim();
  await proposeContract(ctx, userId, room.id, {
    ...template.contract,
    completionCriteria: template.contract.completionCriteria.map((c, i) => ({
      ...c,
      description: c.description.trim() || `Completion criterion ${i + 1}`,
    })),
    objective: objective || template.contract.objective || input.name,
    participants: [
      { organization: org.name, role: "customer" },
      { organization: "Counterpart", role: "provider" },
    ],
  });

  await setParticipantPolicy(ctx, userId, room.id, template.policy);

  // Agent: the caller's choice, else the organization's sandbox agent (which
  // is provisioned at signup, so there is always one).
  const connections = await ctx.store.listAgentConnections(input.organizationId);
  const chosen =
    (input.agentConnectionId && connections.find((c) => c.id === input.agentConnectionId)) ||
    connections.find((c) => c.status === "ACTIVE");
  if (chosen) await connectAgentToRoom(ctx, userId, room.id, chosen.id);

  await approveContract(ctx, userId, room.id, 1);

  const { invite, token } = await createInvite(ctx, userId, room.id, {
    ...(input.counterpartEmail ? { targetEmail: input.counterpartEmail } : {}),
  });

  let invitationEmailed = false;
  if (input.counterpartEmail) {
    await notifyInvitation(ctx, {
      inviteId: invite.id,
      toEmail: input.counterpartEmail,
      invitingOrganization: org.name,
      roomName: room.name,
      objective: objective || null,
      token,
      expiresAt: invite.expiresAt,
      personalNote: input.personalNote,
      organizationId: input.organizationId,
      roomId: room.id,
    });
    invitationEmailed = true;
  }

  const remaining: string[] = [];
  if (!chosen) remaining.push("Connect an agent for your organization");
  if (!input.counterpartEmail) remaining.push("Send the invitation link to the other company");
  remaining.push("Wait for the other company to accept, then start the room");

  const fresh = (await ctx.store.getRoom(room.id)) ?? room;
  return {
    room: fresh,
    inviteToken: token,
    inviteUrl: `/invite?token=${encodeURIComponent(token)}`,
    invitationEmailed,
    remaining,
  };
}

export interface AcceptInvitationInput {
  token: string;
  organizationId: string;
  /** Defaults to the mirrored template policy the inviter used. */
  policy?: unknown;
  agentConnectionId?: string;
}

export interface AcceptInvitationResult {
  roomId: string;
  roomName: string;
  state: string;
  ready: boolean;
  remaining: string[];
}

/**
 * Join a room and complete this side's setup in one action: policy, agent, and
 * contract approval. The invited party still sees the full contract preview
 * before calling this — accepting is an informed act, just not a ten-step one.
 */
export async function acceptInvitation(
  ctx: Ctx,
  userId: string,
  input: AcceptInvitationInput,
): Promise<AcceptInvitationResult> {
  const participant = await redeemInvite(ctx, userId, input.token, input.organizationId);
  const roomId = participant.roomId;

  // Default policy: mirror what the contract actually permits, so the invited
  // side is neither over- nor under-permissive by accident. Denied classes stay
  // denied; nothing outside the agreed scope is allowed.
  const contract = await ctx.store.latestContractVersion(roomId);
  const policy =
    input.policy ??
    (contract
      ? {
          allowedEventTypes: [
            "message",
            "clarification_request",
            "clarification_response",
            "data_request",
            "data_response",
            "action_proposal",
            "action_result",
            "evidence_submission",
            "completion_proposal",
          ],
          dataClassRules: {
            ...Object.fromEntries(contract.contract.permittedDataClasses.map((c) => [c, "ALLOW"])),
            ...Object.fromEntries(contract.contract.forbiddenDataClasses.map((c) => [c, "DENY"])),
          },
          maxAutoSensitivity: "CONFIDENTIAL",
          autonomousActions: contract.contract.permittedActions,
          approvalRequiredActions: [],
        }
      : null);
  if (policy) await setParticipantPolicy(ctx, userId, roomId, policy);

  const connections = await ctx.store.listAgentConnections(input.organizationId);
  const chosen =
    (input.agentConnectionId && connections.find((c) => c.id === input.agentConnectionId)) ||
    connections.find((c) => c.status === "ACTIVE");
  if (chosen) await connectAgentToRoom(ctx, userId, roomId, chosen.id);

  if (contract) await approveContract(ctx, userId, roomId, contract.version);

  const room = await ctx.store.getRoom(roomId);
  const remaining: string[] = [];
  if (!chosen) remaining.push("Connect an agent for your organization");
  if (room?.state !== "READY") remaining.push("Waiting for the other organization to finish its setup");

  return {
    roomId,
    roomName: room?.name ?? "",
    state: room?.state ?? "UNKNOWN",
    ready: room?.state === "READY",
    remaining,
  };
}

/**
 * What still stands between this room and running, per side. Drives the
 * checklist in the UI so nobody has to guess why "Start" is not available.
 */
export async function roomSetupStatus(ctx: Ctx, userId: string, roomId: string) {
  const { room, participant } = await requireRoomAccess(ctx, userId, roomId);
  const participants = await ctx.store.listParticipants(roomId);
  const contract = await ctx.store.latestContractVersion(roomId);
  const invites = await ctx.store.listInvites(roomId);

  const mine = participants.find((p) => p.id === participant.id);
  const theirs = participants.find((p) => p.id !== participant.id);

  const steps = [
    {
      id: "contract",
      label: "Task contract written",
      done: Boolean(contract),
      yours: true,
    },
    {
      id: "policy",
      label: "Your disclosure policy set",
      done: Boolean(mine?.policy),
      yours: true,
    },
    {
      id: "agent",
      label: "Your agent connected",
      done: Boolean(mine?.agentConnectionId),
      yours: true,
    },
    {
      id: "approve",
      label: contract ? `You approved contract v${contract.version}` : "You approved the contract",
      done: Boolean(contract && mine?.contractApprovedVersion === contract.version),
      yours: true,
    },
    {
      id: "invited",
      label: "Other company invited",
      done: invites.length > 0 || participants.length > 1,
      yours: true,
    },
    {
      id: "joined",
      label: "Other company joined",
      done: participants.length > 1,
      yours: false,
    },
    {
      id: "their_setup",
      label: "Other company finished setup",
      done: Boolean(theirs?.policy && theirs?.agentConnectionId && contract && theirs?.contractApprovedVersion === contract.version),
      yours: false,
    },
  ];

  return {
    roomState: room.state,
    canStart: room.state === "READY",
    steps,
    nextAction:
      steps.find((s) => s.yours && !s.done)?.label ??
      (room.state === "READY" ? "Start the room" : steps.find((s) => !s.done)?.label ?? null),
  };
}
