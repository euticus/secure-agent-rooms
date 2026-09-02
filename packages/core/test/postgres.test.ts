import { afterAll, describe, expect, it } from "vitest";
import { PgStore, migrate } from "@booth/database";
import {
  RoomRuntimeManager,
  approveCompletion,
  closeRoom,
  decideApproval,
  submitCandidateEvent,
  verifyAudit,
  verifyEvidence,
  requireRoomAccess,
  registerOrganization,
  createCtx,
} from "../src/index.js";
import { setupActiveRoom } from "./helpers.js";

/**
 * Durability + concurrency verification against real Postgres.
 *
 * Runs only when BOOTH_TEST_DATABASE_URL is set (CI provides a service
 * container); otherwise skipped so the default suite stays hermetic.
 */
const url = process.env.BOOTH_TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

let store: PgStore | null = null;

d("PgStore (durable storage)", () => {
  async function pgStore(): Promise<PgStore> {
    if (!store) {
      await migrate(url!);
      store = new PgStore(url!);
    }
    return store;
  }

  afterAll(async () => {
    await store?.close();
    store = null;
  });

  it("runs the full collaboration flow durably", async () => {
    const world = await setupActiveRoom({ store: await pgStore() });
    const { ctx, roomId, orgA, orgB } = world;

    const req = await submitCandidateEvent(ctx, orgA.participantId, {
      body: { type: "data_request", purpose: "sizing", requestedFields: ["database_engine"] },
    });
    expect(req.status).toBe("allowed");
    const requestId = req.status === "allowed" ? req.event.id : "";

    const res = await submitCandidateEvent(ctx, orgB.participantId, {
      body: { type: "data_response", requestId, data: { database_engine: "PostgreSQL", leak: "x" } },
      declaredClassification: { sensitivity: "CONFIDENTIAL", categories: ["infrastructure_metadata"] },
    });
    expect(res.status).toBe("allowed");
    // Structural filtering survives the durable round-trip.
    if (res.status === "allowed") {
      expect((res.event.body as { data: Record<string, unknown> }).data).toEqual({ database_engine: "PostgreSQL" });
    }

    // Sequences are assigned by the database, monotonic per room.
    const events = await ctx.store.listRoomEvents(roomId);
    expect(events.map((e) => e.sequence)).toEqual(events.map((_, i) => i + 1));
  });

  it("enforces the secret-disclosure floor and tenant isolation", async () => {
    const world = await setupActiveRoom({ store: await pgStore() });
    const leak = await submitCandidateEvent(world.ctx, world.orgB.participantId, {
      body: { type: "message", text: "key AKIAIOSFODNN7EXAMPLE" },
    });
    expect(leak.status).toBe("denied");

    const outsider = await registerOrganization(world.ctx, {
      orgName: "Mallory",
      email: `mallory-${Math.random().toString(36).slice(2, 10)}@evil.example`,
      displayName: "M",
    });
    await expect(requireRoomAccess(world.ctx, outsider.user.id, world.roomId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("consumes an approval exactly once under concurrency", async () => {
    const world = await setupActiveRoom({ store: await pgStore() });
    const proposal = await submitCandidateEvent(world.ctx, world.orgB.participantId, {
      body: {
        type: "action_proposal",
        action: "change_dns",
        parameters: { record: "api.example.com", to: "20.4.5.6" },
        reason: "cutover",
      },
    });
    if (proposal.status !== "requires_approval") throw new Error("expected approval hold");

    const results = await Promise.allSettled([
      decideApproval(world.ctx, world.orgB.userId, proposal.approvalId, "approve"),
      decideApproval(world.ctx, world.orgB.userId, proposal.approvalId, "approve"),
      decideApproval(world.ctx, world.orgB.userId, proposal.approvalId, "approve"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const events = await world.ctx.store.listRoomEvents(world.roomId);
    expect(events.filter((e) => e.type === "action_authorized")).toHaveLength(1);
  });

  it("keeps the audit hash chain intact across concurrent writers", async () => {
    const world = await setupActiveRoom({ store: await pgStore() });
    // Fire several pipeline submissions concurrently; each writes audit events.
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        submitCandidateEvent(world.ctx, world.orgA.participantId, {
          body: { type: "message", text: `concurrent ${i}` },
        }),
      ),
    );
    const integrity = await verifyAudit(world.ctx);
    expect(integrity.chainValid).toBe(true);
  });

  it("drives a room server-side and completes it durably", async () => {
    const world = await setupActiveRoom({ store: await pgStore() });
    const runtime = new RoomRuntimeManager(world.ctx, { turnDelayMs: 0, maxTurnsPerPickup: 40 });
    await runtime.runOnce(world.roomId);

    const evidence = await world.ctx.store.listEvidence(world.roomId);
    expect(evidence.length).toBeGreaterThan(0);
    for (const e of evidence) await verifyEvidence(world.ctx, world.orgB.userId, world.roomId, e.id);

    const room = await world.ctx.store.getRoom(world.roomId);
    if (room?.state === "COMPLETION_PROPOSED") {
      await approveCompletion(world.ctx, world.orgA.userId, world.roomId);
      await approveCompletion(world.ctx, world.orgB.userId, world.roomId);
      expect((await world.ctx.store.getRoom(world.roomId))?.state).toBe("COMPLETED");
      await closeRoom(world.ctx, world.orgA.userId, world.roomId);
      expect((await world.ctx.store.getRoom(world.roomId))?.state).toBe("CLOSED");
    }
    const integrity = await verifyAudit(world.ctx);
    expect(integrity.chainValid).toBe(true);
    expect(integrity.checkpointsValid).toBe(true);
  });

  it("survives a simulated restart: a new store instance sees prior state", async () => {
    const world = await setupActiveRoom({ store: await pgStore() });
    await submitCandidateEvent(world.ctx, world.orgA.participantId, {
      body: { type: "message", text: "persisted before restart" },
    });
    // New store + ctx == a fresh process pointed at the same database.
    const fresh = new PgStore(url!);
    try {
      const ctx2 = createCtx({ store: fresh });
      const room = await ctx2.store.getRoom(world.roomId);
      expect(room?.id).toBe(world.roomId);
      const events = await ctx2.store.listRoomEvents(world.roomId);
      expect(events.some((e) => (e.body as { text?: string }).text === "persisted before restart")).toBe(true);
    } finally {
      await fresh.close();
    }
  });
});
