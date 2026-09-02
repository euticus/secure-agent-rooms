import { hashToken, newId, newSecretToken } from "@booth/shared";
import { timingSafeEqual } from "node:crypto";
import type { AgentConnection, AdapterType, Organization, User } from "@booth/database";
import type { Ctx } from "./context.js";
import { AppError, forbidden, notFound } from "./errors.js";
import { requireMembership } from "./authz.js";
import { audit } from "./audit.js";
import { hashPassword, validatePasswordStrength, verifyPassword } from "./passwords.js";
import { notifyWelcome } from "./notifications.js";

/**
 * Identity service.
 *
 * Human authentication sits behind this module so an external OIDC IdP can
 * replace it without touching the rest of the API (spec §25). The built-in
 * provider is password-based: scrypt hashes, constant-time verification, and
 * uniform errors that do not reveal whether an account exists.
 */

export async function registerOrganization(
  ctx: Ctx,
  input: { orgName: string; email: string; displayName: string; password?: string },
): Promise<{ organization: Organization; user: User }> {
  // Self-serve registration creates a NEW user. It must never adopt an existing
  // account — otherwise register would hand a live session for someone else's
  // email to whoever calls it (impersonation). Returning users authenticate.
  const existingUser = await ctx.store.getUserByEmail(input.email);
  if (existingUser) {
    throw new AppError("CONFLICT", "an account already exists for this email; sign in instead");
  }
  // A password is required unless the deployment runs the passwordless dev IdP.
  let passwordHash: string | null = null;
  if (input.password) {
    const weak = validatePasswordStrength(input.password);
    if (weak) throw new AppError("VALIDATION", weak);
    passwordHash = await hashPassword(input.password);
  } else if (!ctx.config.devAuthEnabled) {
    throw new AppError("VALIDATION", "a password is required");
  }
  const user: User = {
    id: newId("user"),
    email: input.email,
    displayName: input.displayName,
    passwordHash,
    emailNotifications: true,
    createdAt: ctx.clock.now().toISOString(),
  };
  await ctx.store.createUser(user);

  const organization: Organization = {
    id: newId("org"),
    name: input.orgName,
    createdAt: ctx.clock.now().toISOString(),
  };
  await ctx.store.createOrganization(organization);
  await ctx.store.createMembership({
    id: newId("mem"),
    organizationId: organization.id,
    userId: user.id,
    role: "owner",
    createdAt: ctx.clock.now().toISOString(),
  });
  await audit(ctx, {
    action: "ORGANIZATION_CREATED",
    actorType: "user",
    actorId: user.id,
    organizationId: organization.id,
  });

  // Onboarding: give every new organization a working agent immediately, so a
  // room can reach READY without a separate setup trip. It needs no
  // credentials and cannot reach anything outside the room.
  await ctx.store.createAgentConnection({
    id: newId("conn"),
    organizationId: organization.id,
    name: "Sandbox agent",
    adapterType: "SCRIPTED",
    status: "ACTIVE",
    endpoint: null,
    agentCardHash: null,
    credentialReference: null,
    config: {},
    createdAt: ctx.clock.now().toISOString(),
    lastVerifiedAt: null,
  });
  await notifyWelcome(ctx, { user, organizationName: organization.name });
  return { organization, user };
}

/** Mint a bearer session for an already-authenticated user. */
export async function createSession(ctx: Ctx, email: string): Promise<{ token: string; userId: string }> {
  const user = await ctx.store.getUserByEmail(email);
  if (!user) throw notFound("user");
  return issueSession(ctx, user);
}

async function issueSession(ctx: Ctx, user: User): Promise<{ token: string; userId: string }> {
  const token = newSecretToken();
  await ctx.store.createSession({
    token: hashToken(token),
    userId: user.id,
    expiresAt: new Date(ctx.clock.now().getTime() + 12 * 3600_000).toISOString(),
  });
  return { token, userId: user.id };
}

/**
 * Password authentication. Always performs a hash comparison — including for
 * unknown emails — so response timing does not reveal which accounts exist,
 * and returns one uniform error for every failure mode.
 */
const DUMMY_HASH =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function authenticate(
  ctx: Ctx,
  email: string,
  password: string,
): Promise<{ token: string; userId: string }> {
  const user = await ctx.store.getUserByEmail(email);
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.passwordHash || !ok) {
    await audit(ctx, {
      action: "AUTH_FAILED",
      actorType: "system",
      metadata: { emailDomain: email.split("@")[1] ?? "unknown" },
    });
    throw new AppError("UNAUTHENTICATED", "invalid email or password");
  }
  await audit(ctx, { action: "AUTH_SUCCEEDED", actorType: "user", actorId: user.id });
  return issueSession(ctx, user);
}

/**
 * Closed-beta signup gate. When BOOTH_SIGNUP_KEY is configured, self-serve
 * registration additionally requires that exact key (compared in constant time).
 */
export function signupKeyRequired(): boolean {
  return Boolean(process.env.BOOTH_SIGNUP_KEY);
}

/**
 * A live, unredeemed room invitation is an alternative to the signup key:
 * otherwise a closed beta silently dead-ends every counterpart an existing
 * customer invites, which breaks the product's whole two-sided premise.
 */
export async function inviteTokenGrantsSignup(ctx: Ctx, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const invite = await ctx.store.getInviteByTokenHash(hashToken(token));
  if (!invite) return false;
  if (invite.revokedAt) return false;
  if (new Date(invite.expiresAt).getTime() < ctx.clock.now().getTime()) return false;
  return invite.redemptions < invite.maxRedemptions;
}

export function checkSignupKey(provided: string | undefined): boolean {
  const expected = process.env.BOOTH_SIGNUP_KEY;
  if (!expected) return true; // not gated
  if (!provided) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function resolveSession(ctx: Ctx, token: string): Promise<User> {
  const session = await ctx.store.getSession(hashToken(token));
  if (!session) throw new AppError("UNAUTHENTICATED", "invalid session");
  if (new Date(session.expiresAt).getTime() < ctx.clock.now().getTime()) {
    throw new AppError("UNAUTHENTICATED", "session expired");
  }
  const user = await ctx.store.getUser(session.userId);
  if (!user) throw new AppError("UNAUTHENTICATED", "invalid session");
  return user;
}

/** Revoke a bearer session (logout). Idempotent. */
export async function revokeSession(ctx: Ctx, token: string): Promise<void> {
  await ctx.store.deleteSession(hashToken(token));
}

export async function createAgentConnection(
  ctx: Ctx,
  userId: string,
  input: {
    organizationId: string;
    name: string;
    adapterType: AdapterType;
    endpoint?: string;
    agentCardHash?: string;
    credentialReference?: string;
    config?: Record<string, unknown>;
  },
): Promise<AgentConnection> {
  await requireMembership(ctx, userId, input.organizationId, { admin: true });
  const conn: AgentConnection = {
    id: newId("conn"),
    organizationId: input.organizationId,
    name: input.name,
    adapterType: input.adapterType,
    status: "ACTIVE",
    endpoint: input.endpoint ?? null,
    agentCardHash: input.agentCardHash ?? null,
    credentialReference: input.credentialReference ?? null,
    config: input.config ?? {},
    createdAt: ctx.clock.now().toISOString(),
    lastVerifiedAt: null,
  };
  await ctx.store.createAgentConnection(conn);
  await audit(ctx, {
    action: "AGENT_CONNECTION_CREATED",
    actorType: "user",
    actorId: userId,
    organizationId: input.organizationId,
    resource: conn.id,
    metadata: { adapterType: conn.adapterType },
  });
  return conn;
}

export async function listAgentConnections(ctx: Ctx, userId: string, organizationId: string) {
  await requireMembership(ctx, userId, organizationId);
  const conns = await ctx.store.listAgentConnections(organizationId);
  // credential_reference stays server-side (spec §44).
  return conns.map(({ credentialReference: _cr, ...rest }) => rest);
}

export async function getOwnedAgentConnection(
  ctx: Ctx,
  organizationId: string,
  connectionId: string,
): Promise<AgentConnection> {
  const conn = await ctx.store.getAgentConnection(connectionId);
  if (!conn || conn.organizationId !== organizationId) throw notFound("agent connection");
  if (conn.status !== "ACTIVE") throw forbidden(`agent connection is ${conn.status}`);
  return conn;
}
