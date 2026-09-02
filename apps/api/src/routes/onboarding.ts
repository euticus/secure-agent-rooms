import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ROOM_TEMPLATES } from "@booth/shared";
import {
  acceptInvitation,
  emailConfig,
  launchRoom,
  roomSetupStatus,
  setEmailNotifications,
  type Ctx,
} from "@booth/core";

/**
 * Onboarding endpoints: the short paths that turn a signup into a running
 * room. Each one is a convenience wrapper over the same authorized services
 * the long path uses — no control is skipped.
 */
export async function registerOnboardingRoutes(app: FastifyInstance, ctx: Ctx) {
  const f = app.withTypeProvider<import("fastify-type-provider-zod").ZodTypeProvider>();

  /** Template catalog for the create-room screen. */
  f.get("/v1/templates", async () =>
    ROOM_TEMPLATES.map((t) => ({
      id: t.id,
      name: t.name,
      summary: t.summary,
      audience: t.audience,
      objective: t.objective,
      permittedDataClasses: t.contract.permittedDataClasses,
      forbiddenDataClasses: t.contract.forbiddenDataClasses,
      approvalRequiredActions: t.contract.approvalRequiredActions,
      completionCriteria: t.contract.completionCriteria.map((c) => c.description).filter(Boolean),
    })),
  );

  /** One call: create, configure, approve, and invite. */
  f.post(
    "/v1/rooms/launch",
    {
      schema: {
        body: z.object({
          organizationId: z.string(),
          templateId: z.string(),
          name: z.string().min(1).max(300),
          objective: z.string().max(5000).optional(),
          counterpartEmail: z.string().email().optional(),
          personalNote: z.string().max(500).optional(),
          agentConnectionId: z.string().optional(),
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
    async (req) => launchRoom(ctx, req.user.id, req.body),
  );

  /** One call for the invited side: join, set policy, connect agent, approve. */
  f.post(
    "/v1/invites/:token/accept",
    {
      schema: {
        params: z.object({ token: z.string() }),
        body: z.object({
          organizationId: z.string(),
          agentConnectionId: z.string().optional(),
          policy: z.unknown().optional(),
        }),
      },
    },
    async (req) =>
      acceptInvitation(ctx, req.user.id, {
        token: req.params.token,
        organizationId: req.body.organizationId,
        agentConnectionId: req.body.agentConnectionId,
        policy: req.body.policy,
      }),
  );

  /** What still stands between this room and running. */
  f.get(
    "/v1/rooms/:roomId/setup",
    { schema: { params: z.object({ roomId: z.string() }) } },
    async (req) => roomSetupStatus(ctx, req.user.id, req.params.roomId),
  );

  /** Notification preferences (in-app notifications are always on). */
  f.get("/v1/notifications/settings", async (req) => ({
    emailNotifications: req.user.emailNotifications,
    emailEnabled: emailConfig().enabled,
  }));

  f.put(
    "/v1/notifications/settings",
    { schema: { body: z.object({ emailNotifications: z.boolean() }) } },
    async (req) => {
      await setEmailNotifications(ctx, req.user.id, req.body.emailNotifications);
      return { emailNotifications: req.body.emailNotifications };
    },
  );

  /** Deliver queued notifications now — used by tests and manual flushes. */
  f.post("/v1/notifications/flush", async (req, reply) => {
    // Any authenticated user may nudge the queue; it sends only their own
    // organizations' already-queued mail, and the dispatcher runs anyway.
    void req;
    const sent = await app.dispatcher.tick();
    return reply.send({ sent });
  });
}
