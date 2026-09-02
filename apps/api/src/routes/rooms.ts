import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  approveCompletion,
  approveContract,
  cancelRoom,
  closeRoom,
  completionStatus,
  connectAgentToRoom,
  createInvite,
  createRoom,
  pauseRoom,
  previewInvite,
  proposeContract,
  redeemInvite,
  requireMembership,
  requireRoomAccess,
  resumeRoom,
  setParticipantPolicy,
  startRoom,
  verifyEvidence,
  type Ctx,
} from "@booth/core";

export async function registerRoomRoutes(app: FastifyInstance, ctx: Ctx) {
  const f = app.withTypeProvider<import("fastify-type-provider-zod").ZodTypeProvider>();
  const roomParams = z.object({ roomId: z.string() });

  f.post(
    "/v1/rooms",
    {
      schema: {
        body: z.object({
          organizationId: z.string(),
          name: z.string().min(1).max(300),
          description: z.string().max(5000).optional(),
          budget: z
            .object({
              maxTurns: z.number().int().positive().max(10_000).optional(),
              maxDurationMinutes: z.number().int().positive().max(10_080).optional(),
              maxToolCalls: z.number().int().positive().max(100_000).optional(),
              maxModelSpendUsd: z.number().positive().max(10_000).optional(),
            })
            .optional(),
        }),
      },
    },
    async (req) => createRoom(ctx, req.user.id, req.body),
  );

  f.get(
    "/v1/rooms",
    { schema: { querystring: z.object({ organizationId: z.string() }) } },
    async (req) => {
      await requireMembership(ctx, req.user.id, req.query.organizationId);
      return ctx.store.listRoomsForOrg(req.query.organizationId);
    },
  );

  f.get("/v1/rooms/:roomId", { schema: { params: roomParams } }, async (req) => {
    const { room } = await requireRoomAccess(ctx, req.user.id, req.params.roomId);
    const participants = await ctx.store.listParticipants(room.id);
    const contract = await ctx.store.latestContractVersion(room.id);
    const completion = await completionStatus(ctx, room.id);
    const orgs = await Promise.all(participants.map((p) => ctx.store.getOrganization(p.organizationId)));
    return {
      room,
      participants: participants.map((p, i) => ({
        id: p.id,
        organizationId: p.organizationId,
        organizationName: orgs[i]?.name ?? "unknown",
        role: p.role,
        hasPolicy: p.policy !== null,
        agentConnected: p.agentConnectionId !== null,
        contractApprovedVersion: p.contractApprovedVersion,
        completionApproved: p.completionApprovedByUserId !== null,
      })),
      contract: contract ? { version: contract.version, contract: contract.contract } : null,
      completion,
    };
  });

  f.post(
    "/v1/rooms/:roomId/invites",
    {
      schema: {
        params: roomParams,
        body: z.object({
          targetEmail: z.string().email().optional(),
          targetDomain: z.string().max(200).optional(),
          expiresInHours: z.number().positive().max(720).optional(),
        }),
      },
    },
    async (req) => {
      const { invite, token } = await createInvite(ctx, req.user.id, req.params.roomId, req.body);
      // The raw token is returned exactly once and never stored.
      return { inviteId: invite.id, token, expiresAt: invite.expiresAt };
    },
  );

  f.get(
    "/v1/invites/:token",
    { schema: { params: z.object({ token: z.string() }) } },
    async (req) => previewInvite(ctx, req.user.id, req.params.token),
  );

  f.post(
    "/v1/invites/:token/redeem",
    {
      schema: {
        params: z.object({ token: z.string() }),
        body: z.object({ organizationId: z.string() }),
      },
    },
    async (req) => redeemInvite(ctx, req.user.id, req.params.token, req.body.organizationId),
  );

  f.put(
    "/v1/rooms/:roomId/contract",
    { schema: { params: roomParams, body: z.object({ contract: z.unknown() }) } },
    async (req) => proposeContract(ctx, req.user.id, req.params.roomId, req.body.contract),
  );

  f.post(
    "/v1/rooms/:roomId/contract/approve",
    { schema: { params: roomParams, body: z.object({ version: z.number().int().positive() }) } },
    async (req) => {
      await approveContract(ctx, req.user.id, req.params.roomId, req.body.version);
      return { ok: true };
    },
  );

  f.put(
    "/v1/rooms/:roomId/policy",
    { schema: { params: roomParams, body: z.object({ policy: z.unknown() }) } },
    async (req) => setParticipantPolicy(ctx, req.user.id, req.params.roomId, req.body.policy),
  );

  f.post(
    "/v1/rooms/:roomId/agent",
    { schema: { params: roomParams, body: z.object({ agentConnectionId: z.string() }) } },
    async (req) => {
      await connectAgentToRoom(ctx, req.user.id, req.params.roomId, req.body.agentConnectionId);
      return { ok: true };
    },
  );

  for (const [action, fn] of [
    ["start", startRoom],
    ["pause", pauseRoom],
    ["resume", resumeRoom],
    ["cancel", cancelRoom],
    ["close", closeRoom],
  ] as const) {
    f.post(`/v1/rooms/:roomId/${action}`, { schema: { params: roomParams } }, async (req) => {
      const room = await fn(ctx, req.user.id, req.params.roomId);
      return { state: room?.state };
    });
  }

  f.get("/v1/rooms/:roomId/evidence", { schema: { params: roomParams } }, async (req) => {
    await requireRoomAccess(ctx, req.user.id, req.params.roomId);
    return ctx.store.listEvidence(req.params.roomId);
  });

  f.post(
    "/v1/rooms/:roomId/evidence/:evidenceId/verify",
    { schema: { params: z.object({ roomId: z.string(), evidenceId: z.string() }) } },
    async (req) => {
      await verifyEvidence(ctx, req.user.id, req.params.roomId, req.params.evidenceId);
      return { ok: true };
    },
  );

  f.post("/v1/rooms/:roomId/completion/approve", { schema: { params: roomParams } }, async (req) => {
    const room = await approveCompletion(ctx, req.user.id, req.params.roomId);
    return { state: room?.state };
  });
}
