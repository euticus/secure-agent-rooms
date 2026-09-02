import { Pool, type PoolClient } from "pg";
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

/**
 * Durable Postgres store (schema: migrations/0001_init.sql).
 *
 * Concurrency-sensitive operations use SQL-level guarantees rather than
 * read-then-write in application code:
 *  - room event and audit sequencing take a transaction-scoped advisory lock,
 *    so the hash chain cannot fork under concurrent writers;
 *  - approval decisions use a conditional UPDATE (compare-and-set), so an
 *    approval can be consumed exactly once even across replicas.
 */
export class PgStore implements Store {
  private readonly pool: Pool;

  constructor(connectionString: string, opts: { max?: number; ssl?: boolean } = {}) {
    this.pool = new Pool({
      connectionString,
      max: opts.max ?? 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      keepAlive: true,
      ...(opts.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    // An error on an IDLE client is emitted on the pool. Without a listener,
    // Node treats it as an unhandled 'error' event and terminates the process —
    // which a managed Postgres failover would trigger routinely.
    this.pool.on("error", (err) => {
      this.onPoolError?.(err);
    });
  }

  /** Optional hook so the host can log pool-level errors. */
  onPoolError?: (err: Error) => void;

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async q<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query(text, params as never[]);
    return res.rows as T[];
  }

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const out = await fn(client);
      await client.query("commit");
      return out;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // ---- organizations & users -------------------------------------------

  async createOrganization(org: Organization) {
    await this.q(`insert into organizations (id, name, created_at) values ($1,$2,$3)`, [
      org.id, org.name, org.createdAt,
    ]);
  }
  async getOrganization(id: string) {
    const [r] = await this.q<{ id: string; name: string; created_at: Date }>(
      `select * from organizations where id = $1`, [id],
    );
    return r ? { id: r.id, name: r.name, createdAt: iso(r.created_at) } : null;
  }
  async createUser(user: User) {
    await this.q(
      `insert into users (id, email, display_name, password_hash, email_notifications, created_at)
       values ($1,$2,$3,$4,$5,$6)`,
      [user.id, user.email, user.displayName, user.passwordHash, user.emailNotifications, user.createdAt],
    );
  }
  async updateUser(user: User) {
    await this.q(
      `update users set display_name=$2, password_hash=$3, email_notifications=$4 where id=$1`,
      [user.id, user.displayName, user.passwordHash, user.emailNotifications],
    );
  }
  async getUser(id: string) {
    const [r] = await this.q<UserRow>(`select * from users where id = $1`, [id]);
    return r ? toUser(r) : null;
  }
  async getUserByEmail(email: string) {
    const [r] = await this.q<UserRow>(`select * from users where lower(email) = lower($1)`, [email]);
    return r ? toUser(r) : null;
  }
  async createMembership(m: OrganizationMembership) {
    await this.q(
      `insert into organization_memberships (id, organization_id, user_id, role, created_at) values ($1,$2,$3,$4,$5)`,
      [m.id, m.organizationId, m.userId, m.role, m.createdAt],
    );
  }
  async getMembership(orgId: string, userId: string) {
    const [r] = await this.q<MembershipRow>(
      `select * from organization_memberships where organization_id = $1 and user_id = $2`, [orgId, userId],
    );
    return r ? toMembership(r) : null;
  }
  async listMembershipsForUser(userId: string) {
    const rows = await this.q<MembershipRow>(`select * from organization_memberships where user_id = $1`, [userId]);
    return rows.map(toMembership);
  }
  async listMembershipsForOrg(orgId: string) {
    const rows = await this.q<MembershipRow>(
      `select * from organization_memberships where organization_id = $1 order by created_at`, [orgId],
    );
    return rows.map(toMembership);
  }
  async updateMembership(m: OrganizationMembership) {
    await this.q(`update organization_memberships set role = $2 where id = $1`, [m.id, m.role]);
  }
  async deleteMembership(id: string) {
    await this.q(`delete from organization_memberships where id = $1`, [id]);
  }
  async listApprovalsForOrg(orgId: string) {
    const rows = await this.q<ApprovalRow>(
      `select distinct a.* from approvals a
       left join room_participants p on p.room_id = a.room_id
       where a.approver_org_id = $1 or p.organization_id = $1
       order by a.created_at desc`, [orgId],
    );
    return rows.map(toApproval);
  }

  // ---- sessions ---------------------------------------------------------

  async createSession(s: Session) {
    await this.q(
      `insert into sessions (token_hash, user_id, expires_at) values ($1,$2,$3)
       on conflict (token_hash) do update set user_id = excluded.user_id, expires_at = excluded.expires_at`,
      [s.token, s.userId, s.expiresAt],
    );
  }
  async getSession(tokenHash: string) {
    const [r] = await this.q<{ token_hash: string; user_id: string; expires_at: Date }>(
      `select * from sessions where token_hash = $1`, [tokenHash],
    );
    return r ? { token: r.token_hash, userId: r.user_id, expiresAt: iso(r.expires_at) } : null;
  }
  async deleteSession(tokenHash: string) {
    await this.q(`delete from sessions where token_hash = $1`, [tokenHash]);
  }

  // ---- agent connections ------------------------------------------------

  async createAgentConnection(c: AgentConnection) {
    await this.q(
      `insert into agent_connections
       (id, organization_id, name, adapter_type, status, endpoint, agent_card_hash, credential_reference, config, created_at, last_verified_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [c.id, c.organizationId, c.name, c.adapterType, c.status, c.endpoint, c.agentCardHash,
       c.credentialReference, JSON.stringify(c.config), c.createdAt, c.lastVerifiedAt],
    );
  }
  async getAgentConnection(id: string) {
    const [r] = await this.q<ConnRow>(`select * from agent_connections where id = $1`, [id]);
    return r ? toConn(r) : null;
  }
  async updateAgentConnection(c: AgentConnection) {
    await this.q(
      `update agent_connections set name=$2, adapter_type=$3, status=$4, endpoint=$5, agent_card_hash=$6,
       credential_reference=$7, config=$8, last_verified_at=$9 where id=$1`,
      [c.id, c.name, c.adapterType, c.status, c.endpoint, c.agentCardHash, c.credentialReference,
       JSON.stringify(c.config), c.lastVerifiedAt],
    );
  }
  async listAgentConnections(orgId: string) {
    const rows = await this.q<ConnRow>(
      `select * from agent_connections where organization_id = $1 order by created_at`, [orgId],
    );
    return rows.map(toConn);
  }

  // ---- rooms & participants ---------------------------------------------

  async createRoom(room: Room) {
    await this.q(
      `insert into rooms (id, name, description, created_by_user_id, creator_org_id, state, budget, usage,
       content_retention_days, audit_retention_days, created_at, started_at, completed_at, closed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [room.id, room.name, room.description, room.createdByUserId, room.creatorOrgId, room.state,
       JSON.stringify(room.budget), JSON.stringify(room.usage), room.contentRetentionDays,
       room.auditRetentionDays, room.createdAt, room.startedAt, room.completedAt, room.closedAt],
    );
  }
  async getRoom(id: string) {
    const [r] = await this.q<RoomRow>(`select * from rooms where id = $1`, [id]);
    return r ? toRoom(r) : null;
  }
  async updateRoom(room: Room) {
    await this.q(
      `update rooms set name=$2, description=$3, state=$4, budget=$5, usage=$6, content_retention_days=$7,
       audit_retention_days=$8, started_at=$9, completed_at=$10, closed_at=$11 where id=$1`,
      [room.id, room.name, room.description, room.state, JSON.stringify(room.budget), JSON.stringify(room.usage),
       room.contentRetentionDays, room.auditRetentionDays, room.startedAt, room.completedAt, room.closedAt],
    );
  }
  async listRoomsForOrg(orgId: string) {
    const rows = await this.q<RoomRow>(
      `select distinct r.* from rooms r
       left join room_participants p on p.room_id = r.id
       where r.creator_org_id = $1 or p.organization_id = $1
       order by r.created_at desc`, [orgId],
    );
    return rows.map(toRoom);
  }
  async listActiveRooms() {
    const rows = await this.q<RoomRow>(
      `select * from rooms where state in ('ACTIVE','COMPLETION_PROPOSED') order by created_at`,
    );
    return rows.map(toRoom);
  }
  async createParticipant(p: RoomParticipant) {
    await this.q(
      `insert into room_participants (id, room_id, organization_id, role, agent_connection_id, policy,
       contract_approved_version, completion_approved_by_user_id, joined_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p.id, p.roomId, p.organizationId, p.role, p.agentConnectionId,
       p.policy ? JSON.stringify(p.policy) : null, p.contractApprovedVersion,
       p.completionApprovedByUserId, p.joinedAt],
    );
  }
  async updateParticipant(p: RoomParticipant) {
    await this.q(
      `update room_participants set role=$2, agent_connection_id=$3, policy=$4, contract_approved_version=$5,
       completion_approved_by_user_id=$6 where id=$1`,
      [p.id, p.role, p.agentConnectionId, p.policy ? JSON.stringify(p.policy) : null,
       p.contractApprovedVersion, p.completionApprovedByUserId],
    );
  }
  async getParticipant(id: string) {
    const [r] = await this.q<PartRow>(`select * from room_participants where id = $1`, [id]);
    return r ? toParticipant(r) : null;
  }
  async listParticipants(roomId: string) {
    const rows = await this.q<PartRow>(
      `select * from room_participants where room_id = $1 order by joined_at`, [roomId],
    );
    return rows.map(toParticipant);
  }

  // ---- invites ----------------------------------------------------------

  async createInvite(i: Invite) {
    await this.q(
      `insert into invites (id, room_id, inviting_org_id, target_email, target_domain, token_hash, expires_at,
       redeemed_at, redeemed_by_user_id, revoked_at, max_redemptions, redemptions, created_by_user_id, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [i.id, i.roomId, i.invitingOrgId, i.targetEmail, i.targetDomain, i.tokenHash, i.expiresAt,
       i.redeemedAt, i.redeemedByUserId, i.revokedAt, i.maxRedemptions, i.redemptions, i.createdByUserId, i.createdAt],
    );
  }
  async getInviteByTokenHash(tokenHash: string) {
    const [r] = await this.q<InviteRow>(`select * from invites where token_hash = $1`, [tokenHash]);
    return r ? toInvite(r) : null;
  }
  async updateInvite(i: Invite) {
    await this.q(
      `update invites set redeemed_at=$2, redeemed_by_user_id=$3, revoked_at=$4, redemptions=$5 where id=$1`,
      [i.id, i.redeemedAt, i.redeemedByUserId, i.revokedAt, i.redemptions],
    );
  }
  async listInvites(roomId: string) {
    const rows = await this.q<InviteRow>(`select * from invites where room_id = $1`, [roomId]);
    return rows.map(toInvite);
  }

  // ---- contracts --------------------------------------------------------

  async createContractVersion(v: TaskContractVersion) {
    await this.q(
      `insert into task_contract_versions (id, room_id, version, contract, created_by_user_id, created_at)
       values ($1,$2,$3,$4,$5,$6)`,
      [v.id, v.roomId, v.version, JSON.stringify(v.contract), v.createdByUserId, v.createdAt],
    );
  }
  async latestContractVersion(roomId: string) {
    const [r] = await this.q<ContractRow>(
      `select * from task_contract_versions where room_id = $1 order by version desc limit 1`, [roomId],
    );
    return r ? toContract(r) : null;
  }
  async listContractVersions(roomId: string) {
    const rows = await this.q<ContractRow>(
      `select * from task_contract_versions where room_id = $1 order by version`, [roomId],
    );
    return rows.map(toContract);
  }

  // ---- room events (server-assigned sequence) ---------------------------

  async appendRoomEvent(event: Omit<RoomEvent, "sequence">): Promise<RoomEvent> {
    return this.tx(async (c) => {
      // Serialize sequence assignment per room.
      await c.query(`select pg_advisory_xact_lock(hashtext($1))`, [`room:${event.roomId}`]);
      const { rows } = await c.query<{ next: string }>(
        `select coalesce(max(sequence), 0) + 1 as next from room_events where room_id = $1`, [event.roomId],
      );
      const sequence = Number(rows[0]!.next);
      await c.query(
        `insert into room_events (id, room_id, sequence, sender_participant_id, recipient_participant_id, type,
         created_at, classification, body, provenance, policy) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [event.id, event.roomId, sequence, event.senderParticipantId, event.recipientParticipantId, event.type,
         event.createdAt, JSON.stringify(event.classification), JSON.stringify(event.body),
         JSON.stringify(event.provenance), JSON.stringify(event.policy)],
      );
      return { ...event, sequence } as RoomEvent;
    });
  }
  async listRoomEvents(roomId: string, afterSequence = 0) {
    const rows = await this.q<EventRow>(
      `select * from room_events where room_id = $1 and sequence > $2 order by sequence`, [roomId, afterSequence],
    );
    return rows.map(toEvent);
  }

  // ---- approvals --------------------------------------------------------

  async createApproval(a: Approval) {
    await this.q(
      `insert into approvals (id, room_id, requested_by_participant_id, candidate_body, event_type, action,
       parameters_hash, risk, reason, status, decided_by_user_id, decided_at, approver_org_id, expires_at,
       created_at, consumed_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [a.id, a.roomId, a.requestedByParticipantId, JSON.stringify(a.candidateBody), a.eventType, a.action,
       a.parametersHash, a.risk, a.reason, a.status, a.decidedByUserId, a.decidedAt, a.approverOrgId,
       a.expiresAt, a.createdAt, a.consumedAt],
    );
  }
  async getApproval(id: string) {
    const [r] = await this.q<ApprovalRow>(`select * from approvals where id = $1`, [id]);
    return r ? toApproval(r) : null;
  }
  async updateApproval(a: Approval) {
    await this.q(
      `update approvals set candidate_body=$2, parameters_hash=$3, status=$4, decided_by_user_id=$5,
       decided_at=$6, expires_at=$7, consumed_at=$8 where id=$1`,
      [a.id, JSON.stringify(a.candidateBody), a.parametersHash, a.status, a.decidedByUserId,
       a.decidedAt, a.expiresAt, a.consumedAt],
    );
  }
  async listApprovals(roomId: string) {
    const rows = await this.q<ApprovalRow>(`select * from approvals where room_id = $1 order by created_at`, [roomId]);
    return rows.map(toApproval);
  }
  /** Conditional UPDATE — the approval transitions out of `fromStatus` once. */
  async claimApproval(id: string, fromStatus: Approval["status"], patch: Partial<Approval>) {
    const rows = await this.q<ApprovalRow>(
      `update approvals set
         status = coalesce($3, status),
         decided_by_user_id = coalesce($4, decided_by_user_id),
         decided_at = coalesce($5, decided_at),
         consumed_at = coalesce($6, consumed_at)
       where id = $1 and status = $2
       returning *`,
      [id, fromStatus, patch.status ?? null, patch.decidedByUserId ?? null,
       patch.decidedAt ?? null, patch.consumedAt ?? null],
    );
    return rows[0] ? toApproval(rows[0]) : null;
  }

  // ---- evidence & criteria ---------------------------------------------

  async createEvidence(e: Evidence) {
    await this.q(
      `insert into evidence (id, room_id, criterion_id, submitted_by_participant_id, evidence_type, description,
       reference, verification, verified_by_user_id, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [e.id, e.roomId, e.criterionId, e.submittedByParticipantId, e.evidenceType, e.description,
       e.reference, e.verification, e.verifiedByUserId, e.createdAt],
    );
  }
  async listEvidence(roomId: string) {
    const rows = await this.q<EvidenceRow>(`select * from evidence where room_id = $1 order by created_at`, [roomId]);
    return rows.map(toEvidence);
  }
  async getEvidence(id: string) {
    const [r] = await this.q<EvidenceRow>(`select * from evidence where id = $1`, [id]);
    return r ? toEvidence(r) : null;
  }
  async updateEvidence(e: Evidence) {
    await this.q(`update evidence set verification=$2, verified_by_user_id=$3 where id=$1`, [
      e.id, e.verification, e.verifiedByUserId,
    ]);
  }
  async upsertCriterionStatus(s: CriterionStatus) {
    await this.q(
      `insert into criterion_statuses (room_id, criterion_id, state) values ($1,$2,$3)
       on conflict (room_id, criterion_id) do update set state = excluded.state`,
      [s.roomId, s.criterionId, s.state],
    );
  }
  async listCriterionStatuses(roomId: string) {
    return this.q<CriterionStatus>(
      `select room_id as "roomId", criterion_id as "criterionId", state from criterion_statuses where room_id = $1`,
      [roomId],
    );
  }

  // ---- audit chain ------------------------------------------------------

  async appendAuditEvent(e: Omit<AuditEvent, "sequence" | "previousHash" | "eventHash">): Promise<AuditEvent> {
    return this.tx(async (c) => {
      // Global lock: the audit chain is a single linked list, so appends must
      // serialize or the chain forks.
      await c.query(`select pg_advisory_xact_lock(hashtext('booth:audit'))`);
      const { rows } = await c.query<{ sequence: string; event_hash: string }>(
        `select sequence, event_hash from audit_events order by sequence desc limit 1`,
      );
      const prev = rows[0];
      const sequence = prev ? Number(prev.sequence) + 1 : 1;
      const chained = chainEvent(prev?.event_hash ?? GENESIS_HASH, { ...e, sequence });
      await c.query(
        `insert into audit_events (id, sequence, timestamp, action, actor_type, actor_id, organization_id,
         room_id, resource, policy_version, decision, metadata, previous_hash, event_hash)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [chained.id, chained.sequence, chained.timestamp, chained.action, chained.actorType, chained.actorId,
         chained.organizationId, chained.roomId, chained.resource, chained.policyVersion, chained.decision,
         JSON.stringify(chained.metadata), chained.previousHash, chained.eventHash],
      );
      return chained;
    });
  }
  async listAuditEvents(filter?: { roomId?: string }) {
    const rows = filter?.roomId
      ? await this.q<AuditRow>(`select * from audit_events where room_id = $1 order by sequence`, [filter.roomId])
      : await this.q<AuditRow>(`select * from audit_events order by sequence`);
    return rows.map(toAudit);
  }
  async auditHead() {
    const [r] = await this.q<{ sequence: string; event_hash: string }>(
      `select sequence, event_hash from audit_events order by sequence desc limit 1`,
    );
    return r ? { sequence: Number(r.sequence), hash: r.event_hash } : { sequence: 0, hash: GENESIS_HASH };
  }
  async saveCheckpoint(cp: AuditCheckpoint) {
    await this.q(
      `insert into audit_checkpoints (id, created_at, up_to_sequence, head_hash, key_id, signature)
       values ($1,$2,$3,$4,$5,$6)`,
      [cp.id, cp.createdAt, cp.upToSequence, cp.headHash, cp.keyId, cp.signature],
    );
  }
  async listCheckpoints() {
    const rows = await this.q<{ id: string; created_at: Date; up_to_sequence: string; head_hash: string; key_id: string; signature: string }>(
      `select * from audit_checkpoints order by up_to_sequence`,
    );
    return rows.map((r) => ({
      id: r.id, createdAt: iso(r.created_at), upToSequence: Number(r.up_to_sequence),
      headHash: r.head_hash, keyId: r.key_id, signature: r.signature,
    }));
  }

  // ---- alerts & idempotency --------------------------------------------

  async createSecurityAlert(a: SecurityAlert) {
    await this.q(
      `insert into security_alerts (id, room_id, organization_id, severity, kind, detail, created_at)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [a.id, a.roomId, a.organizationId, a.severity, a.kind, a.detail, a.createdAt],
    );
  }
  async listSecurityAlerts(orgId?: string) {
    const rows = orgId
      ? await this.q<AlertRow>(
          `select * from security_alerts where organization_id = $1 order by created_at`,
          [orgId],
        )
      : await this.q<AlertRow>(`select * from security_alerts order by created_at`);
    return rows.map((r) => ({
      id: r.id, roomId: r.room_id, organizationId: r.organization_id, severity: r.severity as SecurityAlert["severity"],
      kind: r.kind, detail: r.detail, createdAt: iso(r.created_at),
    }));
  }
  // ---- notification outbox ---------------------------------------------

  async enqueueNotification(n: NotificationRecord) {
    const rows = await this.q<{ id: string }>(
      `insert into notifications
       (id, kind, to_email, subject, body_text, body_html, organization_id, room_id, dedupe_key,
        status, attempts, scheduled_for, last_error, created_at, sent_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       on conflict (dedupe_key) do nothing
       returning id`,
      [n.id, n.kind, n.toEmail, n.subject, n.bodyText, n.bodyHtml, n.organizationId, n.roomId,
       n.dedupeKey, n.status, n.attempts, n.scheduledFor, n.lastError, n.createdAt, n.sentAt],
    );
    return rows.length > 0;
  }

  /** Claim due rows atomically so two dispatchers never send the same mail. */
  async claimPendingNotifications(limit: number, now: string) {
    const rows = await this.q<NotificationRow>(
      `update notifications set attempts = attempts + 1
       where id in (
         select id from notifications
         where status = 'PENDING' and scheduled_for <= $2
         order by scheduled_for
         limit $1
         for update skip locked
       )
       returning *`,
      [limit, now],
    );
    return rows.map(toNotification);
  }

  async markNotificationSent(id: string, sentAt: string) {
    await this.q(
      `update notifications set status='SENT', sent_at=$2, last_error=null where id=$1`, [id, sentAt],
    );
  }

  async markNotificationFailed(id: string, error: string, retryAt: string | null) {
    await this.q(
      `update notifications set status=$3, scheduled_for=coalesce($2, scheduled_for), last_error=$4 where id=$1`,
      [id, retryAt, retryAt ? "PENDING" : "FAILED", error.slice(0, 500)],
    );
  }

  async listNotifications(filter?: { roomId?: string }) {
    const rows = filter?.roomId
      ? await this.q<NotificationRow>(`select * from notifications where room_id = $1 order by created_at`, [filter.roomId])
      : await this.q<NotificationRow>(`select * from notifications order by created_at`);
    return rows.map(toNotification);
  }

  async getIdempotency(scope: string, key: string) {
    const [r] = await this.q<{ scope: string; key: string; response_hash: string; response_body: unknown; created_at: Date }>(
      `select * from idempotency_records where scope = $1 and key = $2`, [scope, key],
    );
    return r
      ? { scope: r.scope, key: r.key, responseHash: r.response_hash, responseBody: r.response_body, createdAt: iso(r.created_at) }
      : null;
  }
  async saveIdempotency(rec: IdempotencyRecord) {
    await this.q(
      `insert into idempotency_records (scope, key, response_hash, response_body, created_at)
       values ($1,$2,$3,$4,$5) on conflict (scope, key) do nothing`,
      [rec.scope, rec.key, rec.responseHash, JSON.stringify(rec.responseBody), rec.createdAt],
    );
  }
}

// ---- row mappers --------------------------------------------------------

const iso = (d: Date | string | null): string => (d === null ? "" : typeof d === "string" ? d : d.toISOString());

interface UserRow {
  id: string; email: string; display_name: string; password_hash: string | null;
  email_notifications: boolean | null; created_at: Date;
}
const toUser = (r: UserRow): User => ({
  id: r.id, email: r.email, displayName: r.display_name,
  passwordHash: r.password_hash ?? null,
  emailNotifications: r.email_notifications ?? true,
  createdAt: iso(r.created_at),
});

interface MembershipRow { id: string; organization_id: string; user_id: string; role: string; created_at: Date }
const toMembership = (r: MembershipRow): OrganizationMembership => ({
  id: r.id, organizationId: r.organization_id, userId: r.user_id,
  role: r.role as OrganizationMembership["role"], createdAt: iso(r.created_at),
});

interface ConnRow {
  id: string; organization_id: string; name: string; adapter_type: string; status: string;
  endpoint: string | null; agent_card_hash: string | null; credential_reference: string | null;
  config: Record<string, unknown>; created_at: Date; last_verified_at: Date | null;
}
const toConn = (r: ConnRow): AgentConnection => ({
  id: r.id, organizationId: r.organization_id, name: r.name,
  adapterType: r.adapter_type as AgentConnection["adapterType"], status: r.status as AgentConnection["status"],
  endpoint: r.endpoint, agentCardHash: r.agent_card_hash, credentialReference: r.credential_reference,
  config: r.config ?? {}, createdAt: iso(r.created_at),
  lastVerifiedAt: r.last_verified_at ? iso(r.last_verified_at) : null,
});

interface RoomRow {
  id: string; name: string; description: string; created_by_user_id: string; creator_org_id: string;
  state: string; budget: Room["budget"]; usage: Room["usage"]; content_retention_days: number;
  audit_retention_days: number; created_at: Date; started_at: Date | null; completed_at: Date | null; closed_at: Date | null;
}
const toRoom = (r: RoomRow): Room => ({
  id: r.id, name: r.name, description: r.description, createdByUserId: r.created_by_user_id,
  creatorOrgId: r.creator_org_id, state: r.state as Room["state"], budget: r.budget, usage: r.usage,
  contentRetentionDays: r.content_retention_days, auditRetentionDays: r.audit_retention_days,
  createdAt: iso(r.created_at), startedAt: r.started_at ? iso(r.started_at) : null,
  completedAt: r.completed_at ? iso(r.completed_at) : null, closedAt: r.closed_at ? iso(r.closed_at) : null,
});

interface PartRow {
  id: string; room_id: string; organization_id: string; role: string; agent_connection_id: string | null;
  policy: RoomParticipant["policy"]; contract_approved_version: number | null;
  completion_approved_by_user_id: string | null; joined_at: Date;
}
const toParticipant = (r: PartRow): RoomParticipant => ({
  id: r.id, roomId: r.room_id, organizationId: r.organization_id, role: r.role as RoomParticipant["role"],
  agentConnectionId: r.agent_connection_id, policy: r.policy ?? null,
  contractApprovedVersion: r.contract_approved_version,
  completionApprovedByUserId: r.completion_approved_by_user_id, joinedAt: iso(r.joined_at),
});

interface InviteRow {
  id: string; room_id: string; inviting_org_id: string; target_email: string | null; target_domain: string | null;
  token_hash: string; expires_at: Date; redeemed_at: Date | null; redeemed_by_user_id: string | null;
  revoked_at: Date | null; max_redemptions: number; redemptions: number; created_by_user_id: string; created_at: Date;
}
const toInvite = (r: InviteRow): Invite => ({
  id: r.id, roomId: r.room_id, invitingOrgId: r.inviting_org_id, targetEmail: r.target_email,
  targetDomain: r.target_domain, tokenHash: r.token_hash, expiresAt: iso(r.expires_at),
  redeemedAt: r.redeemed_at ? iso(r.redeemed_at) : null, redeemedByUserId: r.redeemed_by_user_id,
  revokedAt: r.revoked_at ? iso(r.revoked_at) : null, maxRedemptions: r.max_redemptions,
  redemptions: r.redemptions, createdByUserId: r.created_by_user_id, createdAt: iso(r.created_at),
});

interface ContractRow {
  id: string; room_id: string; version: number; contract: TaskContractVersion["contract"];
  created_by_user_id: string; created_at: Date;
}
const toContract = (r: ContractRow): TaskContractVersion => ({
  id: r.id, roomId: r.room_id, version: r.version, contract: r.contract,
  createdByUserId: r.created_by_user_id, createdAt: iso(r.created_at),
});

interface EventRow {
  id: string; room_id: string; sequence: string; sender_participant_id: string | null;
  recipient_participant_id: string | null; type: string; created_at: Date;
  classification: RoomEvent["classification"]; body: unknown;
  provenance: RoomEvent["provenance"]; policy: RoomEvent["policy"];
}
const toEvent = (r: EventRow): RoomEvent => ({
  id: r.id, roomId: r.room_id, sequence: Number(r.sequence), senderParticipantId: r.sender_participant_id,
  recipientParticipantId: r.recipient_participant_id, type: r.type as RoomEvent["type"],
  createdAt: iso(r.created_at), classification: r.classification, body: r.body,
  provenance: r.provenance, policy: r.policy,
});

interface ApprovalRow {
  id: string; room_id: string; requested_by_participant_id: string; candidate_body: unknown; event_type: string;
  action: string | null; parameters_hash: string; risk: string; reason: string; status: string;
  decided_by_user_id: string | null; decided_at: Date | null; approver_org_id: string; expires_at: Date;
  created_at: Date; consumed_at: Date | null;
}
const toApproval = (r: ApprovalRow): Approval => ({
  id: r.id, roomId: r.room_id, requestedByParticipantId: r.requested_by_participant_id,
  candidateBody: r.candidate_body, eventType: r.event_type, action: r.action, parametersHash: r.parameters_hash,
  risk: r.risk as Approval["risk"], reason: r.reason, status: r.status as Approval["status"],
  decidedByUserId: r.decided_by_user_id, decidedAt: r.decided_at ? iso(r.decided_at) : null,
  approverOrgId: r.approver_org_id, expiresAt: iso(r.expires_at), createdAt: iso(r.created_at),
  consumedAt: r.consumed_at ? iso(r.consumed_at) : null,
});

interface EvidenceRow {
  id: string; room_id: string; criterion_id: string; submitted_by_participant_id: string; evidence_type: string;
  description: string; reference: string | null; verification: string; verified_by_user_id: string | null; created_at: Date;
}
const toEvidence = (r: EvidenceRow): Evidence => ({
  id: r.id, roomId: r.room_id, criterionId: r.criterion_id, submittedByParticipantId: r.submitted_by_participant_id,
  evidenceType: r.evidence_type, description: r.description, reference: r.reference,
  verification: r.verification as Evidence["verification"], verifiedByUserId: r.verified_by_user_id,
  createdAt: iso(r.created_at),
});

interface AuditRow {
  id: string; sequence: string; timestamp: Date; action: string; actor_type: string; actor_id: string | null;
  organization_id: string | null; room_id: string | null; resource: string | null; policy_version: string | null;
  decision: string | null; metadata: Record<string, unknown>; previous_hash: string; event_hash: string;
}
const toAudit = (r: AuditRow): AuditEvent => ({
  id: r.id, sequence: Number(r.sequence), timestamp: iso(r.timestamp), action: r.action,
  actorType: r.actor_type as AuditEvent["actorType"], actorId: r.actor_id, organizationId: r.organization_id,
  roomId: r.room_id, resource: r.resource, policyVersion: r.policy_version, decision: r.decision,
  metadata: r.metadata ?? {}, previousHash: r.previous_hash, eventHash: r.event_hash,
});

interface NotificationRow {
  id: string; kind: string; to_email: string; subject: string; body_text: string;
  body_html: string | null; organization_id: string | null; room_id: string | null;
  dedupe_key: string; status: string; attempts: number; scheduled_for: Date;
  last_error: string | null; created_at: Date; sent_at: Date | null;
}
const toNotification = (r: NotificationRow): NotificationRecord => ({
  id: r.id, kind: r.kind, toEmail: r.to_email, subject: r.subject, bodyText: r.body_text,
  bodyHtml: r.body_html, organizationId: r.organization_id, roomId: r.room_id,
  dedupeKey: r.dedupe_key, status: r.status as NotificationRecord["status"], attempts: r.attempts,
  scheduledFor: iso(r.scheduled_for), lastError: r.last_error, createdAt: iso(r.created_at),
  sentAt: r.sent_at ? iso(r.sent_at) : null,
});

interface AlertRow {
  id: string; room_id: string | null; organization_id: string | null; severity: string;
  kind: string; detail: string; created_at: Date;
}
