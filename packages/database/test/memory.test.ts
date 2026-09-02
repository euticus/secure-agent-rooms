import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/index.js";

describe("MemoryStore", () => {
  it("assigns per-room monotonic sequences", async () => {
    const store = new MemoryStore();
    const base = {
      id: "", roomId: "room_1", senderParticipantId: null, recipientParticipantId: null,
      type: "message" as const, createdAt: "2026-01-01T00:00:00Z",
      classification: { sensitivity: "INTERNAL" as const, categories: ["general" as const] },
      body: {}, provenance: { agentId: null, connectorId: null, sourceTool: null },
      policy: { policyVersion: null, decision: "system" as const },
    };
    const e1 = await store.appendRoomEvent({ ...base, id: "evt_1" });
    const e2 = await store.appendRoomEvent({ ...base, id: "evt_2" });
    const other = await store.appendRoomEvent({ ...base, id: "evt_3", roomId: "room_2" });
    expect([e1.sequence, e2.sequence, other.sequence]).toEqual([1, 2, 1]);
    expect(await store.listRoomEvents("room_1", 1)).toHaveLength(1);
  });

  it("chains audit events", async () => {
    const store = new MemoryStore();
    const w = (id: string) =>
      store.appendAuditEvent({
        id, timestamp: "2026-01-01T00:00:00Z", action: "X", actorType: "system",
        actorId: null, organizationId: null, roomId: null, resource: null,
        policyVersion: null, decision: null, metadata: {},
      });
    const a = await w("a1");
    const b = await w("a2");
    expect(b.previousHash).toBe(a.eventHash);
    expect((await store.auditHead()).hash).toBe(b.eventHash);
  });

  it("returns copies, not live references", async () => {
    const store = new MemoryStore();
    await store.createOrganization({ id: "org_1", name: "A", createdAt: "" });
    const got = await store.getOrganization("org_1");
    got!.name = "mutated";
    expect((await store.getOrganization("org_1"))!.name).toBe("A");
  });
});
