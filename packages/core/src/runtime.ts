import {
  EnvCredentialVault,
  createAdapter,
  type AgentAdapter,
  type CredentialVault,
} from "@booth/agents";
import { newId } from "@booth/shared";
import type { Ctx } from "./context.js";
import { RoomOrchestrator } from "./orchestrator.js";
import { audit } from "./audit.js";
import { notifySecurityAlert } from "./notifications.js";

/**
 * Server-side orchestration runtime.
 *
 * A brokered runner (spec §7) that, for each ACTIVE room, resolves each
 * participant's stored agent connection into a live adapter, drives the
 * orchestrator's turn loop, and stops when the room pauses, a human approval
 * is pending, the room leaves ACTIVE, or the exchange goes idle.
 *
 * All progress is derived from persisted state (room events + room.usage), so
 * the runner is restart-safe: on boot it re-discovers ACTIVE rooms and
 * rebuilds adapters from the store — no in-memory orchestrator state to lose.
 *
 * Single-instance for the MVP. For HA, room pickup must take a durable lock
 * (documented as a scaling item) so replicas don't double-drive a room.
 */
export interface RoomRuntimeOptions {
  vault?: CredentialVault;
  pollIntervalMs?: number;
  turnDelayMs?: number;
  maxTurnsPerPickup?: number;
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
}

export class RoomRuntimeManager {
  private readonly vault: CredentialVault;
  private readonly pollIntervalMs: number;
  private readonly turnDelayMs: number;
  private readonly maxTurnsPerPickup: number;
  private readonly log: (msg: string, meta?: Record<string, unknown>) => void;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private scanning = false;
  /** Rooms currently being driven (in-process lock). */
  private driving = new Set<string>();
  /** Room -> last event sequence at which it went idle (avoid re-driving). */
  private quiesced = new Map<string, number>();

  constructor(
    private readonly ctx: Ctx,
    opts: RoomRuntimeOptions = {},
  ) {
    this.vault = opts.vault ?? new EnvCredentialVault();
    this.pollIntervalMs = opts.pollIntervalMs ?? 1500;
    this.turnDelayMs = opts.turnDelayMs ?? 150;
    this.maxTurnsPerPickup = opts.maxTurnsPerPickup ?? 20;
    this.log = opts.logger ?? (() => {});
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.scheduleNext();
    this.log("room runtime started");
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.scan().finally(() => this.scheduleNext());
    }, this.pollIntervalMs);
  }

  private async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const rooms = await this.ctx.store.listActiveRooms();
      for (const room of rooms) {
        if (this.driving.has(room.id)) continue;
        const events = await this.ctx.store.listRoomEvents(room.id);
        const lastSeq = events.at(-1)?.sequence ?? 0;
        if (this.quiesced.get(room.id) === lastSeq) continue; // nothing new since it went idle

        const approvals = await this.ctx.store.listApprovals(room.id);
        if (approvals.some((a) => a.status === "PENDING")) {
          // Human approval outstanding — hold until it is decided (spec §33).
          this.quiesced.set(room.id, lastSeq);
          continue;
        }
        this.driving.add(room.id);
        // Fire-and-forget MUST carry its own rejection handler: an unhandled
        // rejection here would terminate the API process (Node throws on
        // unhandled rejections by default). On failure the room is quiesced so
        // a persistent error cannot become a hot retry loop.
        void this.driveRoom(room.id)
          .catch(async (err) => {
            this.log("room drive failed", { roomId: room.id, error: String(err) });
            await this.quiesceAfterFailure(room.id);
          })
          .finally(() => this.driving.delete(room.id));
      }
    } catch (err) {
      this.log("room runtime scan error", { error: String(err) });
    } finally {
      this.scanning = false;
    }
  }

  /** Park a room after a failure so the poll loop does not spin on it. */
  private async quiesceAfterFailure(roomId: string): Promise<void> {
    try {
      const events = await this.ctx.store.listRoomEvents(roomId);
      this.quiesced.set(roomId, events.at(-1)?.sequence ?? 0);
    } catch {
      // If even reading events fails, park on the current marker so the next
      // scan skips this room rather than retrying it every poll.
      this.quiesced.set(roomId, this.quiesced.get(roomId) ?? -1);
    }
  }

  /** Drive a single room once (public so a /step endpoint can force progress). */
  async runOnce(roomId: string): Promise<void> {
    if (this.driving.has(roomId)) return;
    this.driving.add(roomId);
    try {
      await this.driveRoom(roomId);
    } finally {
      this.driving.delete(roomId);
    }
  }

  private async driveRoom(roomId: string): Promise<void> {
    const participants = await this.ctx.store.listParticipants(roomId);
    if (participants.length < 2) return;

    const orchestrator = new RoomOrchestrator(this.ctx, roomId);
    const adapters: AgentAdapter[] = [];
    try {
      for (const p of participants) {
        if (!p.agentConnectionId) return; // not ready to run
        const conn = await this.ctx.store.getAgentConnection(p.agentConnectionId);
        if (!conn || conn.status !== "ACTIVE") {
          await this.haltRoom(roomId, `agent connection for participant ${p.id} is unavailable`);
          return;
        }
        let adapter: AgentAdapter;
        try {
          adapter = createAdapter(
            {
              id: conn.id,
              organizationId: conn.organizationId,
              adapterType: conn.adapterType,
              endpoint: conn.endpoint,
              agentCardHash: conn.agentCardHash,
              credentialReference: conn.credentialReference,
              config: conn.config,
            },
            this.vault,
          );
          await adapter.connect();
        } catch (err) {
          // e.g. AgentCardChangedError, missing credential, unsupported type.
          await this.ctx.store.updateAgentConnection({ ...conn, status: "NEEDS_REAPPROVAL" });
          await this.haltRoom(roomId, `agent connection ${conn.id} failed to start: ${String(err)}`, conn.organizationId);
          return;
        }
        orchestrator.register(p, adapter);
        adapters.push(adapter);
      }

      let idle = 0;
      for (let i = 0; i < this.maxTurnsPerPickup; i++) {
        const room = await this.ctx.store.getRoom(roomId);
        if (!room || (room.state !== "ACTIVE" && room.state !== "COMPLETION_PROPOSED")) break;

        const before = (await this.ctx.store.listRoomEvents(roomId)).length;
        let progressed: boolean;
        try {
          progressed = await orchestrator.runTurn();
        } catch (err) {
          // A provider failure (bad key, bad model, outage) must be visible to
          // the humans in the room, not an unexplained silence.
          await this.reportAgentFailure(roomId, err);
          break;
        }
        if (!progressed) break;
        const after = (await this.ctx.store.listRoomEvents(roomId)).length;

        // A human approval became pending — stop and wait for a decision.
        const approvals = await this.ctx.store.listApprovals(roomId);
        if (approvals.some((a) => a.status === "PENDING")) break;

        if (after === before) {
          idle += 1;
          if (idle >= 2) break; // both participants had nothing to add
        } else {
          idle = 0;
        }
        if (this.turnDelayMs > 0) await new Promise((r) => setTimeout(r, this.turnDelayMs));
      }
    } finally {
      // Never let cleanup throw: it would mask the real error and leak adapters.
      try {
        const events = await this.ctx.store.listRoomEvents(roomId);
        this.quiesced.set(roomId, events.at(-1)?.sequence ?? 0);
      } catch {
        this.quiesced.set(roomId, this.quiesced.get(roomId) ?? -1);
      }
      for (const a of adapters) await a.disconnect().catch(() => {});
    }
  }

  /**
   * Record an agent/provider failure where humans will see it: a room event, a
   * security alert, and the audit log. The detail is already redacted by the
   * adapter, so it is safe to display.
   */
  private async reportAgentFailure(roomId: string, err: unknown): Promise<void> {
    const detail = err instanceof Error ? err.message : String(err);
    this.log("agent turn failed", { roomId, error: detail });
    await this.ctx.store.appendRoomEvent({
      id: newId("evt"),
      roomId,
      senderParticipantId: null,
      recipientParticipantId: null,
      type: "security_alert",
      createdAt: this.ctx.clock.now().toISOString(),
      classification: { sensitivity: "INTERNAL", categories: ["general"] },
      body: {
        kind: "agent_failure",
        reason: `An agent could not complete its turn. ${detail}`,
        guidance: "Check the agent connection's credential, model, and endpoint, then resume the room.",
      },
      provenance: { agentId: null, connectorId: null, sourceTool: null },
      policy: { policyVersion: "builtin-v1", decision: "system" },
    });
    const room = await this.ctx.store.getRoom(roomId);
    const participants = await this.ctx.store.listParticipants(roomId);
    for (const p of participants) {
      const alertId = newId("alert");
      await this.ctx.store.createSecurityAlert({
        id: alertId,
        roomId,
        organizationId: p.organizationId,
        severity: "MEDIUM",
        kind: "agent_failure",
        detail,
        createdAt: this.ctx.clock.now().toISOString(),
      });
      await notifySecurityAlert(this.ctx, {
        alertId,
        roomId,
        roomName: room?.name ?? "your room",
        organizationId: p.organizationId,
        severity: "MEDIUM",
        kind: "agent_failure",
        detail,
      });
    }
    await audit(this.ctx, {
      action: "SECURITY_ALERT",
      actorType: "system",
      roomId,
      decision: "agent_failure",
      metadata: { detail },
    });
  }

  private async haltRoom(roomId: string, reason: string, organizationId?: string): Promise<void> {
    const room = await this.ctx.store.getRoom(roomId);
    if (room && room.state === "ACTIVE") {
      await this.ctx.store.updateRoom({ ...room, state: "PAUSED" });
    }
    // One alert per participant organization: alerts are tenant-scoped, so a
    // null organization would make this visible to every tenant.
    const orgIds = new Set<string>();
    if (organizationId) orgIds.add(organizationId);
    for (const p of await this.ctx.store.listParticipants(roomId)) orgIds.add(p.organizationId);
    for (const orgId of orgIds) {
      await this.ctx.store.createSecurityAlert({
        id: newId("alert"),
        roomId,
        organizationId: orgId,
        severity: "MEDIUM",
        kind: "agent_runtime_halt",
        detail: reason,
        createdAt: this.ctx.clock.now().toISOString(),
      });
    }
    await audit(this.ctx, {
      action: "ROOM_PAUSED_AUTOMATICALLY",
      actorType: "system",
      roomId,
      metadata: { reason },
    });
    this.log("room halted", { roomId, reason });
  }
}
