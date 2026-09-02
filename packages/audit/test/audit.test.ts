import { describe, expect, it } from "vitest";
import {
  GENESIS_HASH,
  HmacCheckpointSigner,
  canonicalize,
  chainEvent,
  createCheckpoint,
  verifyChain,
  verifyCheckpoint,
  type AuditEvent,
} from "../src/index.js";

function makeChain(n: number): AuditEvent[] {
  const events: AuditEvent[] = [];
  let prev = GENESIS_HASH;
  for (let i = 0; i < n; i++) {
    const e = chainEvent(prev, {
      id: `audit_${i}`,
      sequence: i + 1,
      timestamp: "2026-08-27T00:00:00.000Z",
      action: "ROOM_CREATED",
      actorType: "system",
      actorId: null,
      organizationId: "org_a",
      roomId: "room_1",
      resource: null,
      policyVersion: null,
      decision: null,
      metadata: { i },
    });
    events.push(e);
    prev = e.eventHash;
  }
  return events;
}

describe("canonicalize", () => {
  it("is key-order independent", () => {
    expect(canonicalize({ b: 1, a: [true, null, "x"] })).toBe(canonicalize({ a: [true, null, "x"], b: 1 }));
  });
  it("drops undefined object members", () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("hash chain", () => {
  it("verifies an untampered chain", () => {
    expect(verifyChain(makeChain(10)).valid).toBe(true);
  });

  it("detects modified event content", () => {
    const chain = makeChain(10);
    (chain[4] as { metadata: Record<string, unknown> }).metadata = { i: 999 };
    const v = verifyChain(chain);
    expect(v.valid).toBe(false);
    expect(v.brokenAtSequence).toBe(5);
  });

  it("detects deleted events", () => {
    const chain = makeChain(10);
    chain.splice(3, 1);
    expect(verifyChain(chain).valid).toBe(false);
  });
});

describe("checkpoints", () => {
  const signer = new HmacCheckpointSigner(Buffer.alloc(32, 7));
  it("signs and verifies", () => {
    const chain = makeChain(3);
    const cp = createCheckpoint(signer, "cp_1", "2026-08-27T00:00:00Z", 3, chain[2]!.eventHash);
    expect(verifyCheckpoint(signer, cp)).toBe(true);
  });
  it("rejects a forged checkpoint", () => {
    const chain = makeChain(3);
    const cp = createCheckpoint(signer, "cp_1", "2026-08-27T00:00:00Z", 3, chain[2]!.eventHash);
    expect(verifyCheckpoint(signer, { ...cp, upToSequence: 99 })).toBe(false);
  });
});
