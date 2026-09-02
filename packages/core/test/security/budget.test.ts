import { describe, expect, it } from "vitest";
import { ScriptedAgentAdapter } from "@booth/agents";
import { RoomOrchestrator } from "../../src/index.js";
import { setupActiveRoom } from "../helpers.js";

describe("budgets & runaway agents (T7, spec §32)", () => {
  it("pauses the room when maxTurns is exhausted", async () => {
    const world = await setupActiveRoom({ budget: { maxTurns: 3 } });
    const chatty = (id: string) =>
      new ScriptedAgentAdapter(
        id,
        Array.from({ length: 20 }, (_, i) => () => [
          { body: { type: "message" as const, text: `${id} update ${i}` } },
        ]),
      );
    const orchestrator = new RoomOrchestrator(world.ctx, world.roomId);
    orchestrator.register((await world.ctx.store.getParticipant(world.orgA.participantId))!, chatty("a"));
    orchestrator.register((await world.ctx.store.getParticipant(world.orgB.participantId))!, chatty("b"));
    await orchestrator.runLoop(20);

    const room = await world.ctx.store.getRoom(world.roomId);
    expect(room?.state).toBe("PAUSED");
    expect(room?.usage.turns).toBe(3);
    const events = await world.ctx.store.listRoomEvents(world.roomId);
    expect(events.some((e) => e.type === "room_pause")).toBe(true);
  });

  it("detects infinite loops of near-identical exchanges and pauses", async () => {
    const world = await setupActiveRoom();
    const looper = (id: string) =>
      new ScriptedAgentAdapter(
        id,
        Array.from({ length: 20 }, () => () => [
          { body: { type: "message" as const, text: "are we done yet?" } },
        ]),
      );
    const orchestrator = new RoomOrchestrator(world.ctx, world.roomId);
    orchestrator.register((await world.ctx.store.getParticipant(world.orgA.participantId))!, looper("a"));
    orchestrator.register((await world.ctx.store.getParticipant(world.orgB.participantId))!, looper("b"));
    await orchestrator.runLoop(30);

    const room = await world.ctx.store.getRoom(world.roomId);
    expect(room?.state).toBe("PAUSED");
    // Far fewer turns than the budget — the loop detector fired first.
    expect(room!.usage.turns).toBeLessThan(10);
  });

  it("model spend accumulates against the budget", async () => {
    const world = await setupActiveRoom({ budget: { maxModelSpendUsd: 0.05 } });
    class Spendy extends ScriptedAgentAdapter {
      override async executeTurn() {
        return {
          events: [{ body: { type: "message" as const, text: `tick ${Math.random()}` } }],
          usage: { estimatedCostUsd: 0.03 },
        };
      }
    }
    const orchestrator = new RoomOrchestrator(world.ctx, world.roomId);
    orchestrator.register((await world.ctx.store.getParticipant(world.orgA.participantId))!, new Spendy("a", []));
    orchestrator.register((await world.ctx.store.getParticipant(world.orgB.participantId))!, new Spendy("b", []));
    await orchestrator.runLoop(20);

    const room = await world.ctx.store.getRoom(world.roomId);
    expect(room?.state).toBe("PAUSED");
    expect(room!.usage.modelSpendUsd).toBeGreaterThanOrEqual(0.05);
  });
});
