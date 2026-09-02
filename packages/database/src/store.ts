import type { RoomEvent } from "@booth/shared";
import type { AuditCheckpoint, AuditEvent } from "@booth/audit";
import type {
  AgentConnection,
  Approval,
  CriterionStatus,
  Evidence,
  IdempotencyRecord,
  Invite,
  NotificationRecord,
  Organization,
  OrganizationMembership,
  Room,
  RoomParticipant,
  SecurityAlert,
  Session,
  TaskContractVersion,
  User,
} from "./types.js";

/**
 * Storage interface. The MVP runtime and the full test suite run against the
 * in-memory implementation; the SQL schema in /migrations is the durable
 * Postgres shape for the same entities.
 *
 * IMPORTANT: the store is deliberately dumb — all authorization/tenancy
 * checks live in @booth/core services, which never query without verifying
 * membership first. (Postgres RLS is defense-in-depth on top, not instead.)
 */
export interface Store {
  // organizations & users
  createOrganization(org: Organization): Promise<void>;
  getOrganization(id: string): Promise<Organization | null>;
  createUser(user: User): Promise<void>;
  getUser(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  createMembership(m: OrganizationMembership): Promise<void>;
  getMembership(orgId: string, userId: string): Promise<OrganizationMembership | null>;
  listMembershipsForUser(userId: string): Promise<OrganizationMembership[]>;
  listMembershipsForOrg(orgId: string): Promise<OrganizationMembership[]>;
  updateMembership(m: OrganizationMembership): Promise<void>;
  deleteMembership(id: string): Promise<void>;
  /** Rooms across every organization the user belongs to (for cross-room views). */
  listApprovalsForOrg(orgId: string): Promise<Approval[]>;

  // sessions
  createSession(s: Session): Promise<void>;
  getSession(tokenHash: string): Promise<Session | null>;
  deleteSession(tokenHash: string): Promise<void>;

  // agent connections
  createAgentConnection(c: AgentConnection): Promise<void>;
  getAgentConnection(id: string): Promise<AgentConnection | null>;
  updateAgentConnection(c: AgentConnection): Promise<void>;
  listAgentConnections(orgId: string): Promise<AgentConnection[]>;

  // rooms & participants
  createRoom(room: Room): Promise<void>;
  getRoom(id: string): Promise<Room | null>;
  updateRoom(room: Room): Promise<void>;
  listRoomsForOrg(orgId: string): Promise<Room[]>;
  /** Rooms the orchestration runtime should drive (ACTIVE / COMPLETION_PROPOSED). */
  listActiveRooms(): Promise<Room[]>;
  createParticipant(p: RoomParticipant): Promise<void>;
  updateParticipant(p: RoomParticipant): Promise<void>;
  getParticipant(id: string): Promise<RoomParticipant | null>;
  listParticipants(roomId: string): Promise<RoomParticipant[]>;

  // invites
  createInvite(i: Invite): Promise<void>;
  getInviteByTokenHash(tokenHash: string): Promise<Invite | null>;
  updateInvite(i: Invite): Promise<void>;
  listInvites(roomId: string): Promise<Invite[]>;

  // task contracts
  createContractVersion(v: TaskContractVersion): Promise<void>;
  latestContractVersion(roomId: string): Promise<TaskContractVersion | null>;
  listContractVersions(roomId: string): Promise<TaskContractVersion[]>;

  // room events (append-only, server-assigned sequence)
  appendRoomEvent(event: Omit<RoomEvent, "sequence">): Promise<RoomEvent>;
  listRoomEvents(roomId: string, afterSequence?: number): Promise<RoomEvent[]>;

  // approvals
  createApproval(a: Approval): Promise<void>;
  getApproval(id: string): Promise<Approval | null>;
  updateApproval(a: Approval): Promise<void>;
  listApprovals(roomId: string): Promise<Approval[]>;
  /**
   * Atomic compare-and-set: apply `patch` only if the approval is currently in
   * `fromStatus`. Returns the updated approval, or null if it was not (someone
   * else already decided it). Prevents the double-approve TOCTOU race.
   */
  claimApproval(id: string, fromStatus: Approval["status"], patch: Partial<Approval>): Promise<Approval | null>;

  // evidence & criteria
  createEvidence(e: Evidence): Promise<void>;
  listEvidence(roomId: string): Promise<Evidence[]>;
  getEvidence(id: string): Promise<Evidence | null>;
  updateEvidence(e: Evidence): Promise<void>;
  upsertCriterionStatus(s: CriterionStatus): Promise<void>;
  listCriterionStatuses(roomId: string): Promise<CriterionStatus[]>;

  // audit chain (global, append-only)
  appendAuditEvent(e: Omit<AuditEvent, "sequence" | "previousHash" | "eventHash">): Promise<AuditEvent>;
  listAuditEvents(filter?: { roomId?: string }): Promise<AuditEvent[]>;
  auditHead(): Promise<{ sequence: number; hash: string }>;
  saveCheckpoint(cp: AuditCheckpoint): Promise<void>;
  listCheckpoints(): Promise<AuditCheckpoint[]>;

  // security alerts
  createSecurityAlert(a: SecurityAlert): Promise<void>;
  listSecurityAlerts(orgId?: string): Promise<SecurityAlert[]>;

  // notification outbox
  /** Enqueue; a duplicate dedupeKey is ignored, so callers can be at-least-once. */
  enqueueNotification(n: NotificationRecord): Promise<boolean>;
  claimPendingNotifications(limit: number, now: string): Promise<NotificationRecord[]>;
  markNotificationSent(id: string, sentAt: string): Promise<void>;
  markNotificationFailed(id: string, error: string, retryAt: string | null): Promise<void>;
  listNotifications(filter?: { roomId?: string }): Promise<NotificationRecord[]>;
  updateUser(user: User): Promise<void>;

  // idempotency
  getIdempotency(scope: string, key: string): Promise<IdempotencyRecord | null>;
  saveIdempotency(rec: IdempotencyRecord): Promise<void>;
}
