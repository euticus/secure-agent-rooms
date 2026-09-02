import { newId } from "@booth/shared";
import type { OrgRole, OrganizationMembership, User } from "@booth/database";
import type { Ctx } from "./context.js";
import { AppError, forbidden, notFound } from "./errors.js";
import { requireMembership } from "./authz.js";
import { audit } from "./audit.js";
import { hashPassword, validatePasswordStrength } from "./passwords.js";

/**
 * Organization membership management.
 *
 * A company is a team, not a single login. Admins add colleagues, assign
 * roles, and remove people; an organization can never be left without an
 * owner, and only owners can create or remove other owners.
 */

const ASSIGNABLE_ROLES: OrgRole[] = ["owner", "admin", "security_admin", "member", "auditor"];

export interface MemberView {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string;
  role: OrgRole;
  createdAt: string;
}

export async function listMembers(ctx: Ctx, userId: string, organizationId: string): Promise<MemberView[]> {
  await requireMembership(ctx, userId, organizationId);
  const memberships = await ctx.store.listMembershipsForOrg(organizationId);
  const out: MemberView[] = [];
  for (const m of memberships) {
    const u = await ctx.store.getUser(m.userId);
    if (!u) continue;
    out.push({
      membershipId: m.id,
      userId: u.id,
      email: u.email,
      displayName: u.displayName,
      role: m.role,
      createdAt: m.createdAt,
    });
  }
  return out;
}

/**
 * Add a colleague to your organization. If the person has no account yet, one
 * is created with the supplied initial password (which they should change);
 * an existing account is simply granted membership.
 */
export async function addMember(
  ctx: Ctx,
  actorUserId: string,
  organizationId: string,
  input: { email: string; displayName?: string; role: OrgRole; initialPassword?: string },
): Promise<MemberView> {
  const actor = await requireMembership(ctx, actorUserId, organizationId, { admin: true });
  if (!ASSIGNABLE_ROLES.includes(input.role)) {
    throw new AppError("VALIDATION", "unknown role");
  }
  // Only an owner may mint another owner.
  if (input.role === "owner" && actor.role !== "owner") {
    throw forbidden("only an owner can grant the owner role");
  }

  let user = await ctx.store.getUserByEmail(input.email);
  if (!user) {
    if (!input.initialPassword) {
      throw new AppError("VALIDATION", "an initial password is required for a new teammate");
    }
    const weak = validatePasswordStrength(input.initialPassword);
    if (weak) throw new AppError("VALIDATION", weak);
    user = {
      id: newId("user"),
      email: input.email,
      displayName: input.displayName || input.email,
      passwordHash: await hashPassword(input.initialPassword),
      emailNotifications: true,
      createdAt: ctx.clock.now().toISOString(),
    } satisfies User;
    await ctx.store.createUser(user);
  }

  const member: User = user;
  const existing = await ctx.store.getMembership(organizationId, member.id);
  if (existing) throw new AppError("CONFLICT", "this person is already a member");

  const membership: OrganizationMembership = {
    id: newId("mem"),
    organizationId,
    userId: member.id,
    role: input.role,
    createdAt: ctx.clock.now().toISOString(),
  };
  await ctx.store.createMembership(membership);
  await audit(ctx, {
    action: "MEMBER_ADDED",
    actorType: "user",
    actorId: actorUserId,
    organizationId,
    resource: member.id,
    metadata: { role: input.role },
  });
  return {
    membershipId: membership.id,
    userId: member.id,
    email: member.email,
    displayName: member.displayName,
    role: membership.role,
    createdAt: membership.createdAt,
  };
}

export async function changeMemberRole(
  ctx: Ctx,
  actorUserId: string,
  organizationId: string,
  membershipId: string,
  role: OrgRole,
): Promise<void> {
  const actor = await requireMembership(ctx, actorUserId, organizationId, { admin: true });
  if (!ASSIGNABLE_ROLES.includes(role)) throw new AppError("VALIDATION", "unknown role");
  const memberships = await ctx.store.listMembershipsForOrg(organizationId);
  const target = memberships.find((m) => m.id === membershipId);
  if (!target) throw notFound("membership");

  if ((role === "owner" || target.role === "owner") && actor.role !== "owner") {
    throw forbidden("only an owner can change owner assignments");
  }
  // Never leave an organization without an owner.
  if (target.role === "owner" && role !== "owner") {
    const owners = memberships.filter((m) => m.role === "owner");
    if (owners.length <= 1) throw new AppError("CONFLICT", "an organization must keep at least one owner");
  }
  await ctx.store.updateMembership({ ...target, role });
  await audit(ctx, {
    action: "MEMBER_ROLE_CHANGED",
    actorType: "user",
    actorId: actorUserId,
    organizationId,
    resource: target.userId,
    metadata: { from: target.role, to: role },
  });
}

export async function removeMember(
  ctx: Ctx,
  actorUserId: string,
  organizationId: string,
  membershipId: string,
): Promise<void> {
  const actor = await requireMembership(ctx, actorUserId, organizationId, { admin: true });
  const memberships = await ctx.store.listMembershipsForOrg(organizationId);
  const target = memberships.find((m) => m.id === membershipId);
  if (!target) throw notFound("membership");
  if (target.role === "owner" && actor.role !== "owner") {
    throw forbidden("only an owner can remove an owner");
  }
  if (target.role === "owner" && memberships.filter((m) => m.role === "owner").length <= 1) {
    throw new AppError("CONFLICT", "an organization must keep at least one owner");
  }
  await ctx.store.deleteMembership(target.id);
  await audit(ctx, {
    action: "MEMBER_REMOVED",
    actorType: "user",
    actorId: actorUserId,
    organizationId,
    resource: target.userId,
  });
}

/** Approvals awaiting this organization's humans, across all of its rooms. */
export async function pendingApprovalsForOrg(ctx: Ctx, userId: string, organizationId: string) {
  await requireMembership(ctx, userId, organizationId);
  const approvals = await ctx.store.listApprovalsForOrg(organizationId);
  const pending = approvals.filter((a) => a.status === "PENDING" && a.approverOrgId === organizationId);
  const out = [];
  for (const a of pending) {
    const room = await ctx.store.getRoom(a.roomId);
    out.push({
      id: a.id,
      roomId: a.roomId,
      roomName: room?.name ?? "unknown room",
      action: a.action,
      eventType: a.eventType,
      risk: a.risk,
      reason: a.reason,
      createdAt: a.createdAt,
      expiresAt: a.expiresAt,
    });
  }
  return out;
}


/** Per-user email notification preference (in-app notifications are unaffected). */
export async function setEmailNotifications(ctx: Ctx, userId: string, enabled: boolean): Promise<void> {
  const user = await ctx.store.getUser(userId);
  if (!user) throw notFound("user");
  await ctx.store.updateUser({ ...user, emailNotifications: enabled });
  await audit(ctx, {
    action: "NOTIFICATION_PREFERENCE_CHANGED",
    actorType: "user",
    actorId: userId,
    metadata: { emailNotifications: enabled },
  });
}
