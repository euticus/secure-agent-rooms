import { createCheckpoint, verifyChain, verifyCheckpoint, type AuditEvent } from "@booth/audit";
import { newId } from "@booth/shared";
import type { Ctx } from "./context.js";

export interface AuditWrite {
  action: string;
  actorType: "user" | "agent" | "system";
  actorId?: string | null;
  organizationId?: string | null;
  roomId?: string | null;
  resource?: string | null;
  policyVersion?: string | null;
  decision?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append an immutable, hash-chained audit event. Callers must never put
 * credentials or full restricted payloads into metadata — pass identifiers
 * and redacted summaries only.
 */
export async function audit(ctx: Ctx, w: AuditWrite): Promise<AuditEvent> {
  return ctx.store.appendAuditEvent({
    id: newId("audit"),
    timestamp: ctx.clock.now().toISOString(),
    action: w.action,
    actorType: w.actorType,
    actorId: w.actorId ?? null,
    organizationId: w.organizationId ?? null,
    roomId: w.roomId ?? null,
    resource: w.resource ?? null,
    policyVersion: w.policyVersion ?? null,
    decision: w.decision ?? null,
    metadata: w.metadata ?? {},
  });
}

/** Sign a checkpoint over the current audit head (periodic + at room close). */
export async function checkpointAudit(ctx: Ctx) {
  const head = await ctx.store.auditHead();
  const cp = createCheckpoint(
    ctx.signer,
    newId("cp"),
    ctx.clock.now().toISOString(),
    head.sequence,
    head.hash,
  );
  await ctx.store.saveCheckpoint(cp);
  return cp;
}

/** Full integrity verification of the audit chain and all checkpoints. */
export async function verifyAudit(ctx: Ctx): Promise<{
  chainValid: boolean;
  brokenAtSequence: number | null;
  checkpointsValid: boolean;
}> {
  const events = await ctx.store.listAuditEvents();
  const chain = verifyChain(events);
  const checkpoints = await ctx.store.listCheckpoints();
  const checkpointsValid = checkpoints.every((cp) => verifyCheckpoint(ctx.signer, cp));
  return { chainValid: chain.valid, brokenAtSequence: chain.brokenAtSequence, checkpointsValid };
}
