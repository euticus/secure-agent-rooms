import {
  budgetExceeded,
  type ExecutionBudget,
  type SafeRoomEvent,
} from "@booth/shared";
import { createHash } from "node:crypto";
import { canonicalize } from "@booth/audit";
import { AdapterInvocationError, type AgentAdapter, type AgentTurnInput, type PendingRequest } from "@booth/agents";
import type { RoomEvent, RoomParticipant } from "@booth/database";
import type { Ctx } from "./context.js";
import { AppError, notFound } from "./errors.js";
import { audit } from "./audit.js";
import { completionStatus } from "./rooms.js";
import { submitCandidateEvent, type SubmitResult } from "./pipeline.js";
import { newId } from "@booth/shared";

/**
 * Brokered orchestration loop (spec §7, §33).
 *
 * The orchestrator mediates all communication: it builds a scoped context for
 * one participant, runs that participant's adapter, and feeds every candidate
 * event through the enforcement pipeline. Budgets and loop detection pause
 * the room rather than letting agents run away.
 */

export interface OrchestratorHooks {
  onEvent?: (result: SubmitResult, participantId: string) => void;
}

interface ParticipantRuntime {
  participant: RoomParticipant;
  adapter: AgentAdapter;
  guidance: string | null;
}

export class RoomOrchestrator {
  private runtimes = new Map<string, ParticipantRuntime>();
  /** Participant that took the previous turn, so turns alternate fairly. */
  private lastRanParticipantId: string | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly roomId: string,
    private readonly hooks: OrchestratorHooks = {},
  ) {}

  register(participant: RoomParticipant, adapter: AgentAdapter) {
    if (participant.roomId !== this.roomId) {
      throw new AppError("VALIDATION", "participant does not belong to this room");
    }
    this.runtimes.set(participant.id, { participant, adapter, guidance: null });
  }

  /** Events this participant is allowed to see: theirs, addressed to them, or broadcast. */
  private visibleEvents(events: RoomEvent[], participantId: string): SafeRoomEvent[] {
    return events
      .filter(
        (e) =>
          e.senderParticipantId === participantId ||
          e.recipientParticipantId === participantId ||
          e.recipientParticipantId === null,
      )
      .map((e) => ({
        id: e.id,
        sequence: e.sequence,
        senderParticipantId: e.senderParticipantId,
        type: e.type,
        createdAt: e.createdAt,
        body: e.body,
      }));
  }

  private async buildTurnInput(rt: ParticipantRuntime): Promise<AgentTurnInput> {
    const room = await this.ctx.store.getRoom(this.roomId);
    if (!room) throw notFound("room");
    const contract = await this.ctx.store.latestContractVersion(this.roomId);
    if (!contract) throw new AppError("STATE", "room has no contract");
    const events = await this.ctx.store.listRoomEvents(this.roomId);
    const visible = this.visibleEvents(events, rt.participant.id).slice(-30);

    // Open data/clarification requests addressed to this participant.
    const answered = new Set(
      events
        .filter((e) => e.type === "data_response" || e.type === "clarification_response")
        .map((e) => (e.body as { requestId?: string }).requestId),
    );
    const pendingRequests: PendingRequest[] = events
      .filter(
        (e) =>
          (e.type === "data_request" || e.type === "clarification_request") &&
          e.recipientParticipantId === rt.participant.id &&
          !answered.has(e.id),
      )
      .map((e) => ({ eventId: e.id, type: e.type as PendingRequest["type"], body: e.body }));

    const completion = await completionStatus(this.ctx, this.roomId);
    const remaining: ExecutionBudget = {
      maxTurns: Math.max(0, room.budget.maxTurns - room.usage.turns),
      maxToolCalls: Math.max(0, room.budget.maxToolCalls - room.usage.toolCalls),
      maxDurationMinutes:
        room.usage.startedAtMs === null
          ? room.budget.maxDurationMinutes
          : Math.max(
              0,
              Math.round(
                room.budget.maxDurationMinutes -
                  (this.ctx.clock.now().getTime() - room.usage.startedAtMs) / 60_000,
              ),
            ),
      maxModelSpendUsd: Math.max(0, room.budget.maxModelSpendUsd - room.usage.modelSpendUsd),
    };

    const guidance = rt.guidance;
    rt.guidance = null;
    return {
      roomId: this.roomId,
      participantId: rt.participant.id,
      role: rt.participant.role,
      taskContract: contract.contract,
      permittedCapabilities: contract.contract.permittedActions,
      recentEvents: visible,
      pendingRequests,
      completionState: { criteria: completion.criteria },
      remainingBudget: remaining,
      guidance,
    };
  }

  /**
   * Turn-taking alternates on who actually RAN, not on who last produced an
   * event — otherwise a participant that returns no events would be selected
   * forever and its peer would never get a turn (room stalls).
   */
  private async nextParticipant(): Promise<ParticipantRuntime | null> {
    const runtimes = [...this.runtimes.values()];
    if (runtimes.length === 0) return null;
    if (runtimes.length === 1) return runtimes[0]!;

    if (this.lastRanParticipantId) {
      const other = runtimes.find((r) => r.participant.id !== this.lastRanParticipantId);
      if (other) return other;
    }
    // First turn of this drive: resume from whoever did NOT send the last event,
    // so a restarted runtime continues the conversation rather than repeating it.
    const events = await this.ctx.store.listRoomEvents(this.roomId);
    const lastAgentEvent = [...events]
      .reverse()
      .find((e) => e.senderParticipantId !== null && this.runtimes.has(e.senderParticipantId));
    if (!lastAgentEvent) {
      // Customer opens the conversation.
      return runtimes.find((r) => r.participant.role === "customer") ?? runtimes[0]!;
    }
    return runtimes.find((r) => r.participant.id !== lastAgentEvent.senderParticipantId) ?? runtimes[0]!;
  }

  /** Detect repeated near-identical exchanges (spec §32). */
  private async loopDetected(): Promise<boolean> {
    const events = await this.ctx.store.listRoomEvents(this.roomId);
    const agentBodies = events
      .filter((e) => e.senderParticipantId !== null)
      .slice(-8)
      .map((e) => createHash("sha256").update(canonicalize({ t: e.type, b: e.body })).digest("hex"));
    const counts = new Map<string, number>();
    for (const h of agentBodies) counts.set(h, (counts.get(h) ?? 0) + 1);
    return [...counts.values()].some((c) => c >= 3);
  }

  private async pauseForBudget(reason: string): Promise<void> {
    const room = await this.ctx.store.getRoom(this.roomId);
    if (!room || room.state !== "ACTIVE") return;
    await this.ctx.store.updateRoom({ ...room, state: "PAUSED" });
    await this.ctx.store.appendRoomEvent({
      id: newId("evt"),
      roomId: this.roomId,
      senderParticipantId: null,
      recipientParticipantId: null,
      type: "room_pause",
      createdAt: this.ctx.clock.now().toISOString(),
      classification: { sensitivity: "INTERNAL", categories: ["general"] },
      body: { reason },
      provenance: { agentId: null, connectorId: null, sourceTool: null },
      policy: { policyVersion: "builtin-v1", decision: "system" },
    });
    await audit(this.ctx, {
      action: "ROOM_PAUSED_AUTOMATICALLY",
      actorType: "system",
      roomId: this.roomId,
      metadata: { reason },
    });
  }

  /**
   * Run one participant turn. Returns false when the room can no longer make
   * progress (not active, budget exhausted, loop detected, or nobody to run).
   */
  async runTurn(): Promise<boolean> {
    const room = await this.ctx.store.getRoom(this.roomId);
    if (!room) throw notFound("room");
    if (room.state !== "ACTIVE" && room.state !== "COMPLETION_PROPOSED") return false;

    const exceeded = budgetExceeded(room.budget, room.usage, this.ctx.clock.now().getTime());
    if (exceeded) {
      await this.pauseForBudget(`budget limit reached: ${exceeded}`);
      return false;
    }
    if (await this.loopDetected()) {
      await this.pauseForBudget("loop detected: repeated near-identical agent exchanges");
      return false;
    }

    const rt = await this.nextParticipant();
    if (!rt) return false;
    this.lastRanParticipantId = rt.participant.id;

    const input = await this.buildTurnInput(rt);
    // A provider failure (bad key, bad model, outage) is rethrown so the
    // runtime can surface a diagnostic to the humans in the room — a silently
    // idle room is indistinguishable from a broken product. Other adapter
    // errors are absorbed so one bad turn cannot end the collaboration.
    let result: import("@booth/agents").AgentTurnResult;
    try {
      result = await rt.adapter.executeTurn(input);
    } catch (err) {
      if (err instanceof AdapterInvocationError) throw err;
      result = { events: [], usage: {} };
    }

    // Account usage before processing output.
    const fresh = await this.ctx.store.getRoom(this.roomId);
    if (!fresh) return false;
    await this.ctx.store.updateRoom({
      ...fresh,
      usage: {
        ...fresh.usage,
        turns: fresh.usage.turns + 1,
        modelSpendUsd: fresh.usage.modelSpendUsd + (result.usage.estimatedCostUsd ?? 0),
      },
    });

    for (const candidate of result.events.slice(0, 4)) {
      const submitResult = await submitCandidateEvent(this.ctx, rt.participant.id, candidate, {
        agentId: rt.adapter.id,
        connectorId: rt.participant.agentConnectionId,
      });
      if (submitResult.status === "denied") rt.guidance = submitResult.guidance;
      this.hooks.onEvent?.(submitResult, rt.participant.id);
    }
    return true;
  }

  /** Run turns until the room pauses, completes, or maxIterations is hit. */
  async runLoop(maxIterations = 50): Promise<void> {
    for (let i = 0; i < maxIterations; i++) {
      const progressed = await this.runTurn();
      if (!progressed) return;
    }
  }
}
