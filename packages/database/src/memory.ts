import type { RoomEvent } from "@booth/shared";
import { GENESIS_HASH, chainEvent, type AuditCheckpoint, type AuditEvent } from "@booth/audit";
import type { Store } from "./store.js";
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

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory Store. Backs the MVP runtime, demo, and the entire test suite. */
export class MemoryStore implements Store {
  private orgs = new Map<string, Organization>();
  private users = new Map<string, User>();
  private memberships: OrganizationMembership[] = [];
  private sessions = new Map<string, Session>();
  private connections = new Map<string, AgentConnection>();
  private rooms = new Map<string, Room>();
  private participants = new Map<string, RoomParticipant>();
  private invites = new Map<string, Invite>();
  private contracts: TaskContractVersion[] = [];
  private roomEvents = new Map<string, RoomEvent[]>();
  private approvals = new Map<string, Approval>();
  private evidence = new Map<string, Evidence>();
  private criteria = new Map<string, CriterionStatus>();
  private auditEvents: AuditEvent[] = [];
  private checkpoints: AuditCheckpoint[] = [];
  private alerts: SecurityAlert[] = [];
  private idempotency = new Map<string, IdempotencyRecord>();
  private notifications = new Map<string, NotificationRecord>();
  private notificationDedupe = new Set<string>();

  async createOrganization(org: Organization) { this.orgs.set(org.id, clone(org)); }
  async getOrganization(id: string) { return clone(this.orgs.get(id) ?? null); }
  async createUser(user: User) { this.users.set(user.id, clone(user)); }
  async updateUser(user: User) { this.users.set(user.id, clone(user)); }
  async getUser(id: string) { return clone(this.users.get(id) ?? null); }
  async getUserByEmail(email: string) {
    for (const u of this.users.values()) if (u.email === email) return clone(u);
    return null;
  }
  async createMembership(m: OrganizationMembership) { this.memberships.push(clone(m)); }
  async getMembership(orgId: string, userId: string) {
    return clone(this.memberships.find((m) => m.organizationId === orgId && m.userId === userId) ?? null);
  }
  async listMembershipsForUser(userId: string) {
    return clone(this.memberships.filter((m) => m.userId === userId));
  }
  async listMembershipsForOrg(orgId: string) {
    return clone(this.memberships.filter((m) => m.organizationId === orgId));
  }
  async updateMembership(m: OrganizationMembership) {
    const i = this.memberships.findIndex((x) => x.id === m.id);
    if (i >= 0) this.memberships[i] = clone(m);
  }
  async deleteMembership(id: string) {
    this.memberships = this.memberships.filter((m) => m.id !== id);
  }
  async listApprovalsForOrg(orgId: string) {
    const roomIds = new Set(
      [...this.participants.values()].filter((p) => p.organizationId === orgId).map((p) => p.roomId),
    );
    return clone(
      [...this.approvals.values()].filter((a) => a.approverOrgId === orgId || roomIds.has(a.roomId)),
    );
  }

  async createSession(s: Session) { this.sessions.set(s.token, clone(s)); }
  async getSession(tokenHash: string) { return clone(this.sessions.get(tokenHash) ?? null); }
  async deleteSession(tokenHash: string) { this.sessions.delete(tokenHash); }

  async createAgentConnection(c: AgentConnection) { this.connections.set(c.id, clone(c)); }
  async getAgentConnection(id: string) { return clone(this.connections.get(id) ?? null); }
  async updateAgentConnection(c: AgentConnection) { this.connections.set(c.id, clone(c)); }
  async listAgentConnections(orgId: string) {
    return clone([...this.connections.values()].filter((c) => c.organizationId === orgId));
  }

  async createRoom(room: Room) { this.rooms.set(room.id, clone(room)); }
  async getRoom(id: string) { return clone(this.rooms.get(id) ?? null); }
  async updateRoom(room: Room) { this.rooms.set(room.id, clone(room)); }
  async listRoomsForOrg(orgId: string) {
    const roomIds = new Set(
      [...this.participants.values()].filter((p) => p.organizationId === orgId).map((p) => p.roomId),
    );
    for (const r of this.rooms.values()) if (r.creatorOrgId === orgId) roomIds.add(r.id);
    return clone([...roomIds].map((id) => this.rooms.get(id)!).filter(Boolean));
  }
  async listActiveRooms() {
    return clone(
      [...this.rooms.values()].filter((r) => r.state === "ACTIVE" || r.state === "COMPLETION_PROPOSED"),
    );
  }
  async createParticipant(p: RoomParticipant) { this.participants.set(p.id, clone(p)); }
  async updateParticipant(p: RoomParticipant) { this.participants.set(p.id, clone(p)); }
  async getParticipant(id: string) { return clone(this.participants.get(id) ?? null); }
  async listParticipants(roomId: string) {
    return clone([...this.participants.values()].filter((p) => p.roomId === roomId));
  }

  async createInvite(i: Invite) { this.invites.set(i.id, clone(i)); }
  async getInviteByTokenHash(tokenHash: string) {
    for (const i of this.invites.values()) if (i.tokenHash === tokenHash) return clone(i);
    return null;
  }
  async updateInvite(i: Invite) { this.invites.set(i.id, clone(i)); }
  async listInvites(roomId: string) {
    return clone([...this.invites.values()].filter((i) => i.roomId === roomId));
  }

  async createContractVersion(v: TaskContractVersion) { this.contracts.push(clone(v)); }
  async latestContractVersion(roomId: string) {
    const versions = this.contracts.filter((c) => c.roomId === roomId);
    if (versions.length === 0) return null;
    return clone(versions.reduce((a, b) => (a.version > b.version ? a : b)));
  }
  async listContractVersions(roomId: string) {
    return clone(this.contracts.filter((c) => c.roomId === roomId).sort((a, b) => a.version - b.version));
  }

  async appendRoomEvent(event: Omit<RoomEvent, "sequence">): Promise<RoomEvent> {
    const events = this.roomEvents.get(event.roomId) ?? [];
    const full: RoomEvent = { ...clone(event), sequence: events.length + 1 } as RoomEvent;
    events.push(full);
    this.roomEvents.set(event.roomId, events);
    return clone(full);
  }
  async listRoomEvents(roomId: string, afterSequence = 0) {
    return clone((this.roomEvents.get(roomId) ?? []).filter((e) => e.sequence > afterSequence));
  }

  async createApproval(a: Approval) { this.approvals.set(a.id, clone(a)); }
  async getApproval(id: string) { return clone(this.approvals.get(id) ?? null); }
  async updateApproval(a: Approval) { this.approvals.set(a.id, clone(a)); }
  async listApprovals(roomId: string) {
    return clone([...this.approvals.values()].filter((a) => a.roomId === roomId));
  }
  async claimApproval(id: string, fromStatus: Approval["status"], patch: Partial<Approval>) {
    // No await between read and write: the whole body runs in one microtask,
    // so two interleaved callers cannot both observe `fromStatus`.
    const a = this.approvals.get(id);
    if (!a || a.status !== fromStatus) return null;
    const updated = { ...a, ...patch };
    this.approvals.set(id, updated);
    return clone(updated);
  }

  async createEvidence(e: Evidence) { this.evidence.set(e.id, clone(e)); }
  async listEvidence(roomId: string) {
    return clone([...this.evidence.values()].filter((e) => e.roomId === roomId));
  }
  async getEvidence(id: string) { return clone(this.evidence.get(id) ?? null); }
  async updateEvidence(e: Evidence) { this.evidence.set(e.id, clone(e)); }
  async upsertCriterionStatus(s: CriterionStatus) {
    this.criteria.set(`${s.roomId}:${s.criterionId}`, clone(s));
  }
  async listCriterionStatuses(roomId: string) {
    return clone([...this.criteria.values()].filter((c) => c.roomId === roomId));
  }

  async appendAuditEvent(e: Omit<AuditEvent, "sequence" | "previousHash" | "eventHash">): Promise<AuditEvent> {
    const prev = this.auditEvents.at(-1);
    const sequence = (prev?.sequence ?? 0) + 1;
    const chained = chainEvent(prev?.eventHash ?? GENESIS_HASH, { ...clone(e), sequence });
    this.auditEvents.push(chained);
    return clone(chained);
  }
  async listAuditEvents(filter?: { roomId?: string }) {
    const all = filter?.roomId ? this.auditEvents.filter((e) => e.roomId === filter.roomId) : this.auditEvents;
    return clone(all);
  }
  async auditHead() {
    const last = this.auditEvents.at(-1);
    return { sequence: last?.sequence ?? 0, hash: last?.eventHash ?? GENESIS_HASH };
  }
  async saveCheckpoint(cp: AuditCheckpoint) { this.checkpoints.push(clone(cp)); }
  async listCheckpoints() { return clone(this.checkpoints); }

  async createSecurityAlert(a: SecurityAlert) { this.alerts.push(clone(a)); }
  async listSecurityAlerts(orgId?: string) {
    // Strictly tenant-scoped: an alert without an organization is never shown
    // to a tenant (it would leak another organization's activity).
    return clone(orgId ? this.alerts.filter((a) => a.organizationId === orgId) : this.alerts);
  }

  async enqueueNotification(n: NotificationRecord) {
    if (this.notificationDedupe.has(n.dedupeKey)) return false;
    this.notificationDedupe.add(n.dedupeKey);
    this.notifications.set(n.id, clone(n));
    return true;
  }
  async claimPendingNotifications(limit: number, now: string) {
    const due = [...this.notifications.values()]
      .filter((n) => n.status === "PENDING" && n.scheduledFor <= now)
      .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor))
      .slice(0, limit);
    // Claim by bumping attempts so a concurrent dispatcher cannot take the same row.
    for (const n of due) this.notifications.set(n.id, { ...n, attempts: n.attempts + 1 });
    return clone(due.map((n) => ({ ...n, attempts: n.attempts + 1 })));
  }
  async markNotificationSent(id: string, sentAt: string) {
    const n = this.notifications.get(id);
    if (n) this.notifications.set(id, { ...n, status: "SENT", sentAt, lastError: null });
  }
  async markNotificationFailed(id: string, error: string, retryAt: string | null) {
    const n = this.notifications.get(id);
    if (!n) return;
    this.notifications.set(id, {
      ...n,
      status: retryAt ? "PENDING" : "FAILED",
      scheduledFor: retryAt ?? n.scheduledFor,
      lastError: error.slice(0, 500),
    });
  }
  async listNotifications(filter?: { roomId?: string }) {
    const all = [...this.notifications.values()];
    return clone(filter?.roomId ? all.filter((n) => n.roomId === filter.roomId) : all);
  }

  async getIdempotency(scope: string, key: string) {
    return clone(this.idempotency.get(`${scope}:${key}`) ?? null);
  }
  async saveIdempotency(rec: IdempotencyRecord) {
    this.idempotency.set(`${rec.scope}:${rec.key}`, clone(rec));
  }
}
