import {
  CandidateRoomEvent,
  newId,
  type CandidateEventType,
  type PolicyDecision,
  type PolicyInput,
  type RoomEvent,
} from "@booth/shared";
import { runDlp } from "@booth/dlp";
import { denialGuidance } from "@booth/policy";
import { createHash } from "node:crypto";
import { canonicalize } from "@booth/audit";
import type { Approval, Room, RoomParticipant } from "@booth/database";
import type { Ctx } from "./context.js";
import { AppError, notFound } from "./errors.js";
import { audit } from "./audit.js";
import { completionStatus, quarantineRoom } from "./rooms.js";
import { notifyApprovalPending, notifyCompletionProposed } from "./notifications.js";

export const POLICY_VERSION = "builtin-v1";

export interface Provenance {
  agentId: string | null;
  connectorId: string | null;
  sourceTool: string | null;
}

export type SubmitResult =
  | { status: "allowed"; event: RoomEvent }
  | { status: "denied"; reason: string; rule: string; guidance: string }
  | { status: "requires_approval"; approvalId: string; reason: string }
  | { status: "rejected"; reason: string };

const HIGH_RISK_HINTS = /delete|dns|spend|production|deploy|iam|firewall|secret|payment|transfer/i;

export function parametersHash(body: unknown): string {
  return createHash("sha256").update(canonicalize(body), "utf8").digest("hex");
}

/**
 * The secure event pipeline (spec §33 / Phase 6):
 * candidate -> schema validation -> structural filtering -> classification/DLP
 * -> policy -> {block | approval | persist+route}.
 *
 * Everything an agent emits enters here. There is no other path into the
 * room event stream for agent content.
 */
export async function submitCandidateEvent(
  ctx: Ctx,
  senderParticipantId: string,
  candidateRaw: unknown,
  provenance: Partial<Provenance> = {},
): Promise<SubmitResult> {
  const sender = await ctx.store.getParticipant(senderParticipantId);
  if (!sender) throw notFound("participant");
  const room = await ctx.store.getRoom(sender.roomId);
  if (!room) throw notFound("room");

  // 1. Schema validation — malformed candidates are dropped, never coerced.
  const parsed = CandidateRoomEvent.safeParse(candidateRaw);
  if (!parsed.success) {
    await audit(ctx, {
      action: "MESSAGE_REJECTED_SCHEMA",
      actorType: "agent",
      actorId: provenance.agentId ?? null,
      organizationId: sender.organizationId,
      roomId: room.id,
      metadata: { issues: parsed.error.issues.slice(0, 5).map((i) => i.message) },
    });
    return { status: "rejected", reason: "event failed schema validation" };
  }
  const candidate = parsed.data;
  let body = candidate.body;

  const participants = await ctx.store.listParticipants(room.id);
  const recipient = participants.find((p) => p.id !== sender.id) ?? null;

  // 2. Structural filtering (DLP layer 1): a data_response may only carry the
  //    exact fields the peer requested in the referenced data_request.
  if (body.type === "data_response") {
    const requestId = body.requestId;
    const events = await ctx.store.listRoomEvents(room.id);
    const request = events.find(
      (e) =>
        e.id === requestId &&
        e.type === "data_request" &&
        e.senderParticipantId !== sender.id,
    );
    if (!request) {
      return { status: "rejected", reason: "data_response does not reference a peer data_request" };
    }
    const requested = new Set(
      ((request.body as { requestedFields?: string[] }).requestedFields ?? []),
    );
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body.data)) {
      if (requested.has(k)) filtered[k] = v;
    }
    body = { ...body, data: filtered as typeof body.data };
  }

  // 3. Classification + DLP (layers 2-4).
  const dlp = runDlp(body, candidate.declaredClassification);

  // 4. Deterministic policy decision.
  if (!sender.policy) {
    return { status: "rejected", reason: "participant has no policy configured" };
  }
  const contractVersion = await ctx.store.latestContractVersion(room.id);
  if (!contractVersion) {
    return { status: "rejected", reason: "room has no task contract" };
  }
  const input: PolicyInput = {
    actor: {
      organizationId: sender.organizationId,
      participantId: sender.id,
      agentConnectionId: sender.agentConnectionId,
    },
    room: { id: room.id, state: room.state },
    event: {
      type: body.type as CandidateEventType,
      sensitivity: dlp.classification.sensitivity,
      categories: dlp.classification.categories,
      action: body.type === "action_proposal" ? body.action : undefined,
      requestedFields: body.type === "data_request" ? body.requestedFields : undefined,
      secretFindings: dlp.secretFindings.length,
    },
    recipient: {
      organizationId: recipient?.organizationId ?? null,
      participantId: recipient?.id ?? null,
    },
  };
  const decision = ctx.policyEngine.evaluate(input, sender.policy, contractVersion.contract);

  if (decision.result === "deny") {
    return handleDenied(ctx, room, sender, body.type, decision, dlp.secretFindings.length > 0);
  }
  if (decision.result === "require_approval") {
    return handleRequiresApproval(ctx, room, sender, body, decision, provenance);
  }

  // 5. Persist + route.
  const event = await persistAllowedEvent(ctx, room, sender, recipient, body, dlp.classification, provenance, "allow");
  await applySideEffects(ctx, room, sender, event);
  return { status: "allowed", event };
}

async function handleDenied(
  ctx: Ctx,
  room: Room,
  sender: RoomParticipant,
  eventType: string,
  decision: Extract<PolicyDecision, { result: "deny" }>,
  wasSecret: boolean,
): Promise<SubmitResult> {
  const guidance = denialGuidance(decision);
  // The block event carries reason + rule only — never the blocked content.
  await ctx.store.appendRoomEvent({
    id: newId("evt"),
    roomId: room.id,
    senderParticipantId: null,
    recipientParticipantId: null,
    type: "policy_block",
    createdAt: ctx.clock.now().toISOString(),
    classification: { sensitivity: "INTERNAL", categories: ["general"] },
    body: {
      blockedEventType: eventType,
      blockedParticipantId: sender.id,
      rule: decision.rule,
      reason: decision.reason,
      guidance,
    },
    provenance: { agentId: null, connectorId: null, sourceTool: null },
    policy: { policyVersion: POLICY_VERSION, decision: "deny" },
  });
  await audit(ctx, {
    action: "MESSAGE_BLOCKED",
    actorType: "agent",
    organizationId: sender.organizationId,
    roomId: room.id,
    policyVersion: POLICY_VERSION,
    decision: "deny",
    metadata: { rule: decision.rule, eventType },
  });

  if (wasSecret) {
    await ctx.store.createSecurityAlert({
      id: newId("alert"),
      roomId: room.id,
      organizationId: sender.organizationId,
      severity: "HIGH",
      kind: "secret_disclosure_attempt",
      detail: `Blocked ${eventType} containing secret material (rule ${decision.rule}).`,
      createdAt: ctx.clock.now().toISOString(),
    });
    // Repeated attempts quarantine the room for human review (spec §53).
    const events = await ctx.store.listRoomEvents(room.id);
    const attempts = events.filter(
      (e) =>
        e.type === "policy_block" &&
        (e.body as { blockedParticipantId?: string }).blockedParticipantId === sender.id &&
        (e.body as { rule?: string }).rule === "platform.secret_disclosure",
    ).length;
    if (attempts >= 3) {
      await quarantineRoom(ctx, room.id, "repeated secret disclosure attempts");
    }
  }
  return { status: "denied", reason: decision.reason, rule: decision.rule, guidance };
}

async function handleRequiresApproval(
  ctx: Ctx,
  room: Room,
  sender: RoomParticipant,
  body: CandidateRoomEvent["body"],
  decision: Extract<PolicyDecision, { result: "require_approval" }>,
  provenance: Partial<Provenance>,
): Promise<SubmitResult> {
  const action = body.type === "action_proposal" ? body.action : null;
  const risk: Approval["risk"] =
    action && HIGH_RISK_HINTS.test(action)
      ? "HIGH"
      : decision.rule.startsWith("contract.")
        ? "HIGH"
        : "MEDIUM";
  const approval: Approval = {
    id: newId("approval"),
    roomId: room.id,
    requestedByParticipantId: sender.id,
    candidateBody: body,
    eventType: body.type,
    action,
    parametersHash: parametersHash(body),
    risk,
    reason: decision.reason,
    status: "PENDING",
    decidedByUserId: null,
    decidedAt: null,
    // The disclosing/acting organization's humans decide.
    approverOrgId: sender.organizationId,
    expiresAt: new Date(ctx.clock.now().getTime() + 24 * 3600_000).toISOString(),
    createdAt: ctx.clock.now().toISOString(),
    consumedAt: null,
  };
  await ctx.store.createApproval(approval);
  await ctx.store.appendRoomEvent({
    id: newId("evt"),
    roomId: room.id,
    senderParticipantId: null,
    recipientParticipantId: null,
    type: "approval_request",
    createdAt: ctx.clock.now().toISOString(),
    classification: { sensitivity: "INTERNAL", categories: ["general"] },
    body: {
      approvalId: approval.id,
      requestedByParticipantId: sender.id,
      eventType: body.type,
      action,
      risk,
      reason: decision.reason,
    },
    provenance: { agentId: provenance.agentId ?? null, connectorId: provenance.connectorId ?? null, sourceTool: null },
    policy: { policyVersion: POLICY_VERSION, decision: "require_approval" },
  });
  await audit(ctx, {
    action: "ACTION_PROPOSED",
    actorType: "agent",
    actorId: provenance.agentId ?? null,
    organizationId: sender.organizationId,
    roomId: room.id,
    resource: approval.id,
    policyVersion: POLICY_VERSION,
    decision: "require_approval",
    metadata: { eventType: body.type, action, risk },
  });
  // Tell the humans who have to decide. Email carries only what needs
  // attention and a link — never the held parameters.
  const senderOrg = await ctx.store.getOrganization(sender.organizationId);
  await notifyApprovalPending(ctx, {
    approvalId: approval.id,
    approverOrgId: sender.organizationId,
    roomId: room.id,
    roomName: room.name,
    what: action ?? body.type,
    risk,
    requestedByOrg: senderOrg?.name ?? "the other organization",
  });
  return { status: "requires_approval", approvalId: approval.id, reason: decision.reason };
}

export async function persistAllowedEvent(
  ctx: Ctx,
  room: Room,
  sender: RoomParticipant,
  recipient: RoomParticipant | null,
  body: CandidateRoomEvent["body"],
  classification: RoomEvent["classification"],
  provenance: Partial<Provenance>,
  decision: "allow" | "system",
): Promise<RoomEvent> {
  const event = await ctx.store.appendRoomEvent({
    id: newId("evt"),
    roomId: room.id,
    senderParticipantId: sender.id,
    recipientParticipantId: recipient?.id ?? null,
    type: body.type,
    createdAt: ctx.clock.now().toISOString(),
    classification,
    body,
    provenance: {
      agentId: provenance.agentId ?? null,
      connectorId: provenance.connectorId ?? null,
      sourceTool: provenance.sourceTool ?? null,
    },
    policy: { policyVersion: POLICY_VERSION, decision },
  });
  await audit(ctx, {
    action: "MESSAGE_ALLOWED",
    actorType: "agent",
    actorId: provenance.agentId ?? null,
    organizationId: sender.organizationId,
    roomId: room.id,
    resource: event.id,
    policyVersion: POLICY_VERSION,
    decision: "allow",
    metadata: { eventType: body.type },
  });
  return event;
}

export async function applySideEffects(
  ctx: Ctx,
  room: Room,
  sender: RoomParticipant,
  event: RoomEvent,
): Promise<void> {
  const body = event.body as CandidateRoomEvent["body"];

  if (body.type === "evidence_submission") {
    const contract = await ctx.store.latestContractVersion(room.id);
    const criterion = contract?.contract.completionCriteria.find((c) => c.id === body.criterionId);
    if (!criterion) return;
    await ctx.store.createEvidence({
      id: newId("evd"),
      roomId: room.id,
      criterionId: body.criterionId,
      submittedByParticipantId: sender.id,
      evidenceType: body.evidenceType,
      description: body.description,
      reference: body.reference ?? null,
      // Agent claims are never auto-verified (spec §37).
      verification: "CLAIMED",
      verifiedByUserId: null,
      createdAt: ctx.clock.now().toISOString(),
    });
    // Never let a later agent submission downgrade a criterion a human has
    // already verified back to EVIDENCE_SUBMITTED.
    const existing = await ctx.store.listCriterionStatuses(room.id);
    const current = existing.find((s) => s.criterionId === body.criterionId);
    if (current?.state !== "VERIFIED") {
      await ctx.store.upsertCriterionStatus({
        roomId: room.id,
        criterionId: body.criterionId,
        state: "EVIDENCE_SUBMITTED",
      });
    }
    await audit(ctx, {
      action: "EVIDENCE_CREATED",
      actorType: "agent",
      organizationId: sender.organizationId,
      roomId: room.id,
      metadata: { criterionId: body.criterionId, evidenceType: body.evidenceType },
    });
  }

  if (body.type === "completion_proposal") {
    const { satisfied } = await completionStatus(ctx, room.id);
    if (!satisfied) {
      await ctx.store.appendRoomEvent({
        id: newId("evt"),
        roomId: room.id,
        senderParticipantId: null,
        recipientParticipantId: null,
        type: "completion_rejection",
        createdAt: ctx.clock.now().toISOString(),
        classification: { sensitivity: "INTERNAL", categories: ["general"] },
        body: { reason: "completion criteria are not yet satisfied" },
        provenance: { agentId: null, connectorId: null, sourceTool: null },
        policy: { policyVersion: POLICY_VERSION, decision: "system" },
      });
      return;
    }
    const current = await ctx.store.getRoom(room.id);
    if (current && current.state === "ACTIVE") {
      await ctx.store.updateRoom({ ...current, state: "COMPLETION_PROPOSED" });
      await audit(ctx, { action: "COMPLETION_PROPOSED", actorType: "agent", roomId: room.id });
      await notifyCompletionProposed(ctx, {
        roomId: room.id,
        roomName: current.name,
        detail: body.summary.slice(0, 300),
      });
    }
  }
}
