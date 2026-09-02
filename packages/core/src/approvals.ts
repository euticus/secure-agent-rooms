import { newId, type CandidateRoomEvent } from "@booth/shared";
import { runDlp } from "@booth/dlp";
import type { Ctx } from "./context.js";
import { AppError, notFound } from "./errors.js";
import { requireMembership, requireRoomAccess } from "./authz.js";
import { audit } from "./audit.js";
import { POLICY_VERSION, applySideEffects, parametersHash, persistAllowedEvent } from "./pipeline.js";

/**
 * Human approval service (spec §30).
 *
 * An approval binds to the EXACT parameters (hash of the canonicalized body)
 * captured when the agent proposed the event. Any change invalidates it.
 * Approvals are single-use: once consumed, replaying the same approval id
 * cannot execute the event again.
 */

export async function listApprovalsForRoom(ctx: Ctx, userId: string, roomId: string) {
  await requireRoomAccess(ctx, userId, roomId);
  return ctx.store.listApprovals(roomId);
}

export async function decideApproval(
  ctx: Ctx,
  userId: string,
  approvalId: string,
  decision: "approve" | "reject",
) {
  const approval = await ctx.store.getApproval(approvalId);
  if (!approval) throw notFound("approval");
  // Only humans of the disclosing/acting organization may decide.
  await requireMembership(ctx, userId, approval.approverOrgId, { admin: true });

  if (approval.status !== "PENDING") {
    throw new AppError("CONFLICT", `approval is ${approval.status}, not PENDING`);
  }
  if (new Date(approval.expiresAt).getTime() < ctx.clock.now().getTime()) {
    await ctx.store.updateApproval({ ...approval, status: "EXPIRED" });
    throw new AppError("STATE", "approval expired");
  }

  const room = await ctx.store.getRoom(approval.roomId);
  const sender = await ctx.store.getParticipant(approval.requestedByParticipantId);
  if (!room || !sender) throw notFound("approval");

  if (decision === "reject") {
    // Atomic claim: only one caller can transition PENDING -> REJECTED.
    const claimed = await ctx.store.claimApproval(approvalId, "PENDING", {
      status: "REJECTED",
      decidedByUserId: userId,
      decidedAt: ctx.clock.now().toISOString(),
    });
    if (!claimed) throw new AppError("CONFLICT", "approval already decided");
    await ctx.store.appendRoomEvent({
      id: newId("evt"),
      roomId: room.id,
      senderParticipantId: null,
      recipientParticipantId: null,
      type: "action_rejected",
      createdAt: ctx.clock.now().toISOString(),
      classification: { sensitivity: "INTERNAL", categories: ["general"] },
      body: { approvalId: approval.id, action: approval.action },
      provenance: { agentId: null, connectorId: null, sourceTool: null },
      policy: { policyVersion: POLICY_VERSION, decision: "system" },
    });
    await audit(ctx, {
      action: "ACTION_REJECTED",
      actorType: "user",
      actorId: userId,
      organizationId: approval.approverOrgId,
      roomId: room.id,
      resource: approval.id,
    });
    return { status: "REJECTED" as const };
  }

  // Parameter binding: the body released must hash to exactly what was
  // approved. A swapped/modified body can never ride an existing approval.
  // (Read-only validation first; the atomic claim is the last mutating step.)
  const bodyHash = parametersHash(approval.candidateBody);
  if (bodyHash !== approval.parametersHash) {
    await ctx.store.claimApproval(approvalId, "PENDING", { status: "INVALIDATED" });
    await ctx.store.createSecurityAlert({
      id: newId("alert"),
      roomId: room.id,
      organizationId: approval.approverOrgId,
      severity: "CRITICAL",
      kind: "approval_parameter_mismatch",
      detail: `Approval ${approval.id} parameters changed after proposal; invalidated.`,
      createdAt: ctx.clock.now().toISOString(),
    });
    throw new AppError("CONFLICT", "approval parameters changed; new approval required");
  }

  // Hard DLP floor still applies even to human-approved releases.
  const body = approval.candidateBody as CandidateRoomEvent["body"];
  const dlp = runDlp(body);
  if (dlp.secretFindings.length > 0) {
    await ctx.store.claimApproval(approvalId, "PENDING", { status: "INVALIDATED" });
    throw new AppError("FORBIDDEN", "approved content contains secret material and cannot be released");
  }

  // Atomic single-use claim: only one caller transitions PENDING -> APPROVED,
  // so a concurrent double-approve cannot release the action twice.
  const claimed = await ctx.store.claimApproval(approvalId, "PENDING", {
    status: "APPROVED",
    decidedByUserId: userId,
    decidedAt: ctx.clock.now().toISOString(),
    consumedAt: ctx.clock.now().toISOString(),
  });
  if (!claimed) throw new AppError("CONFLICT", "approval already decided");

  const participants = await ctx.store.listParticipants(room.id);
  const recipient = participants.find((p) => p.id !== sender.id) ?? null;
  const event = await persistAllowedEvent(
    ctx,
    room,
    sender,
    recipient,
    body,
    dlp.classification,
    { agentId: sender.agentConnectionId },
    "allow",
  );
  await ctx.store.appendRoomEvent({
    id: newId("evt"),
    roomId: room.id,
    senderParticipantId: null,
    recipientParticipantId: null,
    type: "action_authorized",
    createdAt: ctx.clock.now().toISOString(),
    classification: { sensitivity: "INTERNAL", categories: ["general"] },
    body: { approvalId: approval.id, action: approval.action, releasedEventId: event.id },
    provenance: { agentId: null, connectorId: null, sourceTool: null },
    policy: { policyVersion: POLICY_VERSION, decision: "system" },
  });
  await audit(ctx, {
    action: "ACTION_APPROVED",
    actorType: "user",
    actorId: userId,
    organizationId: approval.approverOrgId,
    roomId: room.id,
    resource: approval.id,
    metadata: { parametersHash: approval.parametersHash },
  });
  await applySideEffects(ctx, room, sender, event);
  return { status: "APPROVED" as const, eventId: event.id };
}

/** Human verification of submitted evidence (CLAIMED -> HUMAN_VERIFIED). */
export async function verifyEvidence(ctx: Ctx, userId: string, roomId: string, evidenceId: string) {
  await requireRoomAccess(ctx, userId, roomId, { admin: true });
  const evidence = await ctx.store.getEvidence(evidenceId);
  if (!evidence || evidence.roomId !== roomId) throw notFound("evidence");
  await ctx.store.updateEvidence({
    ...evidence,
    verification: "HUMAN_VERIFIED",
    verifiedByUserId: userId,
  });
  await ctx.store.upsertCriterionStatus({
    roomId,
    criterionId: evidence.criterionId,
    state: "VERIFIED",
  });
  await audit(ctx, {
    action: "EVIDENCE_VERIFIED",
    actorType: "user",
    actorId: userId,
    roomId,
    resource: evidenceId,
  });
}
