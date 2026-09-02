import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { decideApproval, listApprovalsForRoom, type Ctx } from "@booth/core";

export async function registerApprovalRoutes(app: FastifyInstance, ctx: Ctx) {
  const f = app.withTypeProvider<import("fastify-type-provider-zod").ZodTypeProvider>();

  f.get(
    "/v1/rooms/:roomId/approvals",
    { schema: { params: z.object({ roomId: z.string() }) } },
    async (req) => listApprovalsForRoom(ctx, req.user.id, req.params.roomId),
  );

  f.post(
    "/v1/approvals/:approvalId/approve",
    { schema: { params: z.object({ approvalId: z.string() }) } },
    async (req) => decideApproval(ctx, req.user.id, req.params.approvalId, "approve"),
  );

  f.post(
    "/v1/approvals/:approvalId/reject",
    { schema: { params: z.object({ approvalId: z.string() }) } },
    async (req) => decideApproval(ctx, req.user.id, req.params.approvalId, "reject"),
  );
}
