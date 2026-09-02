import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  AppError,
  notFound,
  requireRoomAccess,
  submitCandidateEvent,
  verifyAudit,
  type Ctx,
} from "@booth/core";
import { sseStreamState } from "../app.js";

export async function registerEventRoutes(app: FastifyInstance, ctx: Ctx) {
  const f = app.withTypeProvider<import("fastify-type-provider-zod").ZodTypeProvider>();
  const roomParams = z.object({ roomId: z.string() });

  f.get(
    "/v1/rooms/:roomId/events",
    {
      schema: {
        params: roomParams,
        querystring: z.object({ after: z.coerce.number().int().min(0).optional() }),
      },
    },
    async (req) => {
      await requireRoomAccess(ctx, req.user.id, req.params.roomId);
      // Humans of both participant orgs see the full room timeline (blocked
      // events appear as policy_block markers, never with blocked content).
      return ctx.store.listRoomEvents(req.params.roomId, req.query.after ?? 0);
    },
  );

  /**
   * Server-Sent Events stream for UI updates. Durable state remains the
   * source of truth; reconnects catch up via ?after=<sequence>.
   *
   * Bounded: at most SSE_MAX_PER_USER concurrent streams per user, and each
   * stream self-closes after a max lifetime (the client reconnects), which
   * also forces periodic re-authentication.
   */
  f.get(
    "/v1/rooms/:roomId/events/stream",
    {
      schema: {
        params: roomParams,
        querystring: z.object({ after: z.coerce.number().int().min(0).optional() }),
      },
    },
    async (req, reply) => {
      await requireRoomAccess(ctx, req.user.id, req.params.roomId);
      const { sseStreams, max } = sseStreamState();
      const current = sseStreams.get(req.user.id) ?? 0;
      if (current >= max) {
        return reply.status(429).send({ error: { code: "RATE_LIMITED", message: "too many concurrent streams" } });
      }
      sseStreams.set(req.user.id, current + 1);

      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "access-control-allow-origin": ctx.config.webOrigin,
        "access-control-allow-credentials": "true",
      });
      let cursor = req.query.after ?? 0;
      let open = true;
      const deadline = Date.now() + 15 * 60_000; // 15-minute max lifetime
      const cleanup = () => {
        if (!open) return;
        open = false;
        sseStreams.set(req.user.id, Math.max(0, (sseStreams.get(req.user.id) ?? 1) - 1));
      };
      req.raw.on("close", cleanup);
      try {
        while (open && Date.now() < deadline) {
          const events = await ctx.store.listRoomEvents(req.params.roomId, cursor);
          for (const e of events) {
            cursor = Math.max(cursor, e.sequence);
            reply.raw.write(`id: ${e.sequence}\ndata: ${JSON.stringify(e)}\n\n`);
          }
          reply.raw.write(`: keep-alive\n\n`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      } finally {
        cleanup();
        reply.raw.end();
      }
      return reply;
    },
  );

  /**
   * Human-driven submission endpoint. A room admin of the participant's own
   * organization may submit a candidate event on that participant's behalf
   * (e.g. a human sending a message, evidence, or a completion proposal). The
   * candidate goes through the full enforcement pipeline like any agent output.
   *
   * Requires an org admin role — a read-only `auditor`/`observer` cannot inject.
   */
  f.post(
    "/v1/rooms/:roomId/participants/:participantId/events",
    {
      schema: {
        params: z.object({ roomId: z.string(), participantId: z.string() }),
        body: z.object({ candidate: z.unknown() }),
      },
    },
    async (req) => {
      const { participant } = await requireRoomAccess(ctx, req.user.id, req.params.roomId, { admin: true });
      // A caller may only submit on behalf of its own organization's participant.
      if (participant.id !== req.params.participantId) {
        // Report as NOT_FOUND to avoid confirming other participants' ids.
        throw notFound("participant");
      }
      return submitCandidateEvent(ctx, participant.id, req.body.candidate, {
        connectorId: participant.agentConnectionId,
      });
    },
  );

  /** Force one orchestration pass for a room (also runs automatically). */
  f.post("/v1/rooms/:roomId/step", { schema: { params: roomParams } }, async (req) => {
    const { room } = await requireRoomAccess(ctx, req.user.id, req.params.roomId, { admin: true });
    if (room.state !== "ACTIVE" && room.state !== "COMPLETION_PROPOSED") {
      throw new AppError("STATE", `room is ${room.state}; cannot step`);
    }
    await app.runtime.runOnce(req.params.roomId);
    const updated = await ctx.store.getRoom(req.params.roomId);
    return { state: updated?.state };
  });

  f.get("/v1/rooms/:roomId/audit", { schema: { params: roomParams } }, async (req) => {
    await requireRoomAccess(ctx, req.user.id, req.params.roomId);
    const events = await ctx.store.listAuditEvents({ roomId: req.params.roomId });
    const integrity = await verifyAudit(ctx);
    return { events, integrity };
  });
}
