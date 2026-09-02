import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Deterministic JSON canonicalization (RFC 8785-style: lexicographically
 * sorted object keys, no insignificant whitespace). Used so audit hashes are
 * reproducible across processes and languages.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v === undefined ? null : v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error(`cannot canonicalize value of type ${typeof value}`);
}

export const GENESIS_HASH = "0".repeat(64);

export interface AuditEventInput {
  action: string;
  actorType: "user" | "agent" | "system";
  actorId: string | null;
  organizationId: string | null;
  roomId: string | null;
  resource: string | null;
  policyVersion: string | null;
  decision: string | null;
  metadata: Record<string, unknown>;
}

export interface AuditEvent extends AuditEventInput {
  id: string;
  sequence: number;
  timestamp: string;
  previousHash: string;
  eventHash: string;
}

/** hash = SHA256(previous_hash + canonical_event_without_hashes) */
export function computeEventHash(previousHash: string, event: Omit<AuditEvent, "previousHash" | "eventHash">): string {
  return createHash("sha256")
    .update(previousHash, "utf8")
    .update(canonicalize(event), "utf8")
    .digest("hex");
}

export function chainEvent(
  previousHash: string,
  event: Omit<AuditEvent, "previousHash" | "eventHash">,
): AuditEvent {
  return { ...event, previousHash, eventHash: computeEventHash(previousHash, event) };
}

export interface ChainVerification {
  valid: boolean;
  brokenAtSequence: number | null;
}

/** Recompute the whole chain and detect any silent modification. */
export function verifyChain(events: AuditEvent[]): ChainVerification {
  let prev = GENESIS_HASH;
  for (const e of events) {
    const { previousHash, eventHash, ...rest } = e;
    if (previousHash !== prev) return { valid: false, brokenAtSequence: e.sequence };
    const expected = computeEventHash(prev, rest);
    if (expected !== eventHash) return { valid: false, brokenAtSequence: e.sequence };
    prev = eventHash;
  }
  return { valid: true, brokenAtSequence: null };
}

/**
 * Checkpoint signer abstraction. MVP signs with an HMAC key from the
 * environment/secret manager; production swaps in a cloud KMS/HSM asymmetric
 * signer behind the same interface.
 */
export interface CheckpointSigner {
  keyId: string;
  sign(payload: string): string;
  verify(payload: string, signature: string): boolean;
}

export class HmacCheckpointSigner implements CheckpointSigner {
  constructor(private readonly key: Buffer, public readonly keyId: string = "hmac-local") {
    if (key.length < 32) throw new Error("checkpoint signing key must be >= 32 bytes");
  }
  sign(payload: string): string {
    return createHmac("sha256", this.key).update(payload, "utf8").digest("hex");
  }
  verify(payload: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(payload), "hex");
    const got = Buffer.from(signature, "hex");
    return expected.length === got.length && timingSafeEqual(expected, got);
  }
}

export interface AuditCheckpoint {
  id: string;
  createdAt: string;
  upToSequence: number;
  headHash: string;
  keyId: string;
  signature: string;
}

export function createCheckpoint(
  signer: CheckpointSigner,
  id: string,
  createdAt: string,
  upToSequence: number,
  headHash: string,
): AuditCheckpoint {
  const payload = canonicalize({ id, createdAt, upToSequence, headHash });
  return { id, createdAt, upToSequence, headHash, keyId: signer.keyId, signature: signer.sign(payload) };
}

export function verifyCheckpoint(signer: CheckpointSigner, cp: AuditCheckpoint): boolean {
  const payload = canonicalize({
    id: cp.id,
    createdAt: cp.createdAt,
    upToSequence: cp.upToSequence,
    headHash: cp.headHash,
  });
  return signer.verify(payload, cp.signature);
}
