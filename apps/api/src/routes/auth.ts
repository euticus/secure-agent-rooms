import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  addMember,
  authenticate,
  changeMemberRole,
  checkSignupKey,
  inviteTokenGrantsSignup,
  listMembers,
  pendingApprovalsForOrg,
  removeMember,
  createAgentConnection,
  createSession,
  listAgentConnections,
  registerOrganization,
  requireMembership,
  revokeSession,
  type Ctx,
} from "@booth/core";
import { credentialEnvVar, credentialReferenceFor, isSupportedAdapterType } from "@booth/agents";

/**
 * Authentication endpoints.
 *
 * The built-in provider is password-based (scrypt, constant-time verification,
 * no account enumeration). An external OIDC IdP can replace it without
 * touching the rest of the API, which only ever sees bearer sessions (spec §25).
 * `dev-login` is a passwordless convenience that is fail-closed off in production.
 */
export async function registerAuthRoutes(app: FastifyInstance, ctx: Ctx) {
  const f = app.withTypeProvider<import("fastify-type-provider-zod").ZodTypeProvider>();

  f.post(
    "/v1/auth/register",
    {
      schema: {
        body: z.object({
          orgName: z.string().min(1).max(200),
          email: z.string().email(),
          displayName: z.string().min(1).max(200),
          password: z.string().min(1).max(512).optional(),
          /** Required when the deployment sets BOOTH_SIGNUP_KEY (closed beta). */
          signupKey: z.string().max(200).optional(),
          /** A live room invitation also grants signup during a closed beta. */
          inviteToken: z.string().max(200).optional(),
        }),
      },
    },
    async (req, reply) => {
      const gated =
        checkSignupKey(req.body.signupKey) ||
        (await inviteTokenGrantsSignup(ctx, req.body.inviteToken));
      if (!gated) {
        return reply.status(403).send({
          error: {
            code: "FORBIDDEN",
            message: "a valid signup key or room invitation is required",
          },
        });
      }
      // registerOrganization rejects an existing email (no impersonation) and
      // requires a password unless the passwordless dev IdP is enabled.
      const { organization, user } = await registerOrganization(ctx, req.body);
      const session = await createSession(ctx, user.email);
      const { passwordHash: _ph, ...safeUser } = user;
      return { organization, user: safeUser, token: session.token };
    },
  );

  f.post(
    "/v1/auth/login",
    {
      schema: {
        body: z.object({ email: z.string().email(), password: z.string().min(1).max(512) }),
      },
    },
    async (req) => {
      // Uniform error + constant-time comparison: no account enumeration.
      const session = await authenticate(ctx, req.body.email, req.body.password);
      return { token: session.token, userId: session.userId };
    },
  );

  f.post(
    "/v1/auth/dev-login",
    { schema: { body: z.object({ email: z.string().email() }) } },
    async (req, reply) => {
      // Dev-login authenticates as any known user WITHOUT a secret, so it is
      // fail-closed: only available when dev auth is explicitly enabled, and
      // never in production (enforced by resolveConfig).
      if (!ctx.config.devAuthEnabled) {
        return reply.status(403).send({ error: { code: "FORBIDDEN", message: "dev auth disabled" } });
      }
      const session = await createSession(ctx, req.body.email);
      return { token: session.token, userId: session.userId };
    },
  );

  f.post("/v1/auth/logout", async (req) => {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) await revokeSession(ctx, header.slice(7));
    return { ok: true };
  });

  f.get("/v1/me", async (req) => {
    const memberships = await ctx.store.listMembershipsForUser(req.user.id);
    const orgs = [];
    for (const m of memberships) {
      const org = await ctx.store.getOrganization(m.organizationId);
      if (org) orgs.push({ ...org, role: m.role });
    }
    const { passwordHash: _ph, ...safeUser } = req.user;
    return { user: safeUser, organizations: orgs };
  });

  f.post(
    "/v1/agent-connections",
    {
      schema: {
        body: z.object({
          organizationId: z.string(),
          name: z.string().min(1).max(200),
          adapterType: z.enum(["A2A_NATIVE", "HOSTED_ANTHROPIC", "HOSTED_OPENAI", "SCRIPTED"]),
          endpoint: z.string().url().optional(),
          agentCardHash: z.string().max(128).optional(),
          /**
           * A short name for the secret, NOT a raw env var. The server derives
           * the namespaced reference, so a tenant can never point a connection
           * at a platform secret such as the audit key or database URL.
           */
          credentialSlug: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
          config: z.record(z.unknown()).optional(),
        }),
      },
    },
    async (req, reply) => {
      const b = req.body;
      // Reject connections that could never run (spec §66): only build-supported
      // adapter types, with the fields their adapter requires.
      if (!isSupportedAdapterType(b.adapterType)) {
        return reply.status(400).send({ error: { code: "VALIDATION", message: `adapter type ${b.adapterType} is not supported in this build` } });
      }
      if ((b.adapterType === "HOSTED_ANTHROPIC" || b.adapterType === "HOSTED_OPENAI") && !b.credentialSlug) {
        return reply.status(400).send({
          error: {
            code: "VALIDATION",
            message: `${b.adapterType} requires a credentialSlug naming the secret you provisioned (e.g. "openai")`,
          },
        });
      }
      if (b.adapterType === "A2A_NATIVE" && (!b.endpoint || !b.agentCardHash)) {
        return reply.status(400).send({ error: { code: "VALIDATION", message: "A2A_NATIVE requires an endpoint and a pinned agentCardHash" } });
      }
      // Derived server-side and bound to this organization.
      const credentialReference = b.credentialSlug
        ? credentialReferenceFor(b.organizationId, b.credentialSlug)
        : undefined;
      const conn = await createAgentConnection(ctx, req.user.id, { ...b, credentialReference });
      const { credentialReference: _cr, ...safe } = conn;
      // Tell the operator exactly which environment variable to set — the name,
      // never the value.
      return {
        ...safe,
        ...(b.credentialSlug
          ? { credentialEnvVar: credentialEnvVar(b.organizationId, b.credentialSlug) }
          : {}),
      };
    },
  );

  f.get(
    "/v1/agent-connections",
    { schema: { querystring: z.object({ organizationId: z.string() }) } },
    async (req) => listAgentConnections(ctx, req.user.id, req.query.organizationId),
  );

  const orgRoles = z.enum(["owner", "admin", "security_admin", "member", "auditor"]);

  f.get(
    "/v1/organizations/:orgId/members",
    { schema: { params: z.object({ orgId: z.string() }) } },
    async (req) => listMembers(ctx, req.user.id, req.params.orgId),
  );

  f.post(
    "/v1/organizations/:orgId/members",
    {
      schema: {
        params: z.object({ orgId: z.string() }),
        body: z.object({
          email: z.string().email(),
          displayName: z.string().max(200).optional(),
          role: orgRoles.default("member"),
          initialPassword: z.string().min(1).max(512).optional(),
        }),
      },
    },
    async (req) => addMember(ctx, req.user.id, req.params.orgId, req.body),
  );

  f.patch(
    "/v1/organizations/:orgId/members/:membershipId",
    {
      schema: {
        params: z.object({ orgId: z.string(), membershipId: z.string() }),
        body: z.object({ role: orgRoles }),
      },
    },
    async (req) => {
      await changeMemberRole(ctx, req.user.id, req.params.orgId, req.params.membershipId, req.body.role);
      return { ok: true };
    },
  );

  f.delete(
    "/v1/organizations/:orgId/members/:membershipId",
    { schema: { params: z.object({ orgId: z.string(), membershipId: z.string() }) } },
    async (req) => {
      await removeMember(ctx, req.user.id, req.params.orgId, req.params.membershipId);
      return { ok: true };
    },
  );

  /** Approvals waiting on this organization, across every room it is in. */
  f.get(
    "/v1/approvals/pending",
    { schema: { querystring: z.object({ organizationId: z.string() }) } },
    async (req) => pendingApprovalsForOrg(ctx, req.user.id, req.query.organizationId),
  );

  f.get(
    "/v1/security-alerts",
    { schema: { querystring: z.object({ organizationId: z.string() }) } },
    async (req) => {
      await requireMembership(ctx, req.user.id, req.query.organizationId);
      return ctx.store.listSecurityAlerts(req.query.organizationId);
    },
  );
}
