import type { OrganizationMembership, Room, RoomParticipant } from "@booth/database";
import type { Ctx } from "./context.js";
import { forbidden, notFound } from "./errors.js";

/**
 * Central authorization helpers (spec §10). Every data access flows through
 * these — services never trust a client-supplied organization id and never
 * return a resource without verifying membership first.
 */

const ADMIN_ROLES = new Set(["owner", "admin", "security_admin"]);

export async function requireMembership(
  ctx: Ctx,
  userId: string,
  organizationId: string,
  opts: { admin?: boolean } = {},
): Promise<OrganizationMembership> {
  const membership = await ctx.store.getMembership(organizationId, userId);
  if (!membership) throw forbidden("not a member of this organization");
  if (opts.admin && !ADMIN_ROLES.has(membership.role)) {
    throw forbidden("requires an organization admin role");
  }
  return membership;
}

export interface RoomAccess {
  room: Room;
  /** The participant record for the caller's organization in this room. */
  participant: RoomParticipant;
  membership: OrganizationMembership;
}

/**
 * Resolve a room for a user, verifying the user belongs to a participant
 * organization. A room the caller cannot access is reported as NOT_FOUND,
 * identically to a nonexistent room.
 */
export async function requireRoomAccess(
  ctx: Ctx,
  userId: string,
  roomId: string,
  opts: { admin?: boolean } = {},
): Promise<RoomAccess> {
  const room = await ctx.store.getRoom(roomId);
  if (!room) throw notFound("room");
  const memberships = await ctx.store.listMembershipsForUser(userId);
  const participants = await ctx.store.listParticipants(roomId);
  for (const m of memberships) {
    const participant = participants.find((p) => p.organizationId === m.organizationId);
    if (participant) {
      if (opts.admin && !ADMIN_ROLES.has(m.role)) {
        throw forbidden("requires an organization admin role");
      }
      return { room, participant, membership: m };
    }
    // Room creator's org may not yet have a participant row in DRAFT rooms.
    if (room.creatorOrgId === m.organizationId) {
      const creatorParticipant = participants.find((p) => p.organizationId === room.creatorOrgId);
      if (opts.admin && !ADMIN_ROLES.has(m.role)) {
        throw forbidden("requires an organization admin role");
      }
      if (creatorParticipant) return { room, participant: creatorParticipant, membership: m };
    }
  }
  throw notFound("room");
}

/** Verify a participant id actually belongs to the given room. */
export async function requireParticipantInRoom(
  ctx: Ctx,
  roomId: string,
  participantId: string,
): Promise<RoomParticipant> {
  const participant = await ctx.store.getParticipant(participantId);
  if (!participant || participant.roomId !== roomId) throw notFound("participant");
  return participant;
}
