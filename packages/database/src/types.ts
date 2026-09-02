import type {
  ExecutionBudget,
  ParticipantPolicy,
  RoomEvent,
  RoomState,
  TaskContract,
} from "@booth/shared";
import type { AuditEvent, AuditCheckpoint } from "@booth/audit";

export type OrgRole = "owner" | "admin" | "security_admin" | "member" | "auditor";
export type RoomRole = "room_owner" | "participant_admin" | "participant_operator" | "observer" | "auditor";

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  /** scrypt-encoded password hash; null for IdP-provisioned accounts. */
  passwordHash: string | null;
  /** Opt out of transactional email without losing in-app notifications. */
  emailNotifications: boolean;
  createdAt: string;
}

export interface OrganizationMembership {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  createdAt: string;
}

export type AdapterType =
  | "A2A_NATIVE"
  | "HOSTED_ANTHROPIC"
  | "HOSTED_OPENAI"
  | "MCP_BRIDGE"
  | "PRIVATE_GATEWAY"
  | "SCRIPTED"; // deterministic adapter for demos/tests

export interface AgentConnection {
  id: string;
  organizationId: string;
  name: string;
  adapterType: AdapterType;
  status: "ACTIVE" | "DISABLED" | "NEEDS_REAPPROVAL";
  endpoint: string | null;
  agentCardHash: string | null;
  /** Opaque reference into the secret manager. NEVER a secret value. */
  credentialReference: string | null;
  /** Adapter-specific non-secret config (model name, script id, etc.). */
  config: Record<string, unknown>;
  createdAt: string;
  lastVerifiedAt: string | null;
}

export interface Room {
  id: string;
  name: string;
  description: string;
  createdByUserId: string;
  creatorOrgId: string;
  state: RoomState;
  budget: ExecutionBudget;
  usage: { turns: number; toolCalls: number; modelSpendUsd: number; startedAtMs: number | null };
  contentRetentionDays: number;
  auditRetentionDays: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
}

export interface RoomParticipant {
  id: string;
  roomId: string;
  organizationId: string;
  role: "customer" | "provider" | "peer";
  agentConnectionId: string | null;
  policy: ParticipantPolicy | null;
  contractApprovedVersion: number | null;
  completionApprovedByUserId: string | null;
  joinedAt: string;
}

export interface Invite {
  id: string;
  roomId: string;
  invitingOrgId: string;
  targetEmail: string | null;
  targetDomain: string | null;
  tokenHash: string;
  expiresAt: string;
  redeemedAt: string | null;
  redeemedByUserId: string | null;
  revokedAt: string | null;
  maxRedemptions: number;
  redemptions: number;
  createdByUserId: string;
  createdAt: string;
}

export interface TaskContractVersion {
  id: string;
  roomId: string;
  version: number;
  contract: TaskContract;
  createdByUserId: string;
  createdAt: string;
}

export interface Approval {
  id: string;
  roomId: string;
  requestedByParticipantId: string;
  /** The candidate event held for approval, verbatim. */
  candidateBody: unknown;
  eventType: string;
  action: string | null;
  /** SHA-256 over canonicalized parameters — approval binds to EXACT params. */
  parametersHash: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "INVALIDATED";
  decidedByUserId: string | null;
  decidedAt: string | null;
  /** Which org's humans must decide (the disclosing/acting side). */
  approverOrgId: string;
  expiresAt: string;
  createdAt: string;
  consumedAt: string | null;
}

export interface Evidence {
  id: string;
  roomId: string;
  criterionId: string;
  submittedByParticipantId: string;
  evidenceType: string;
  description: string;
  reference: string | null;
  verification: "CLAIMED" | "ATTESTED" | "SYSTEM_VERIFIED" | "HUMAN_VERIFIED";
  verifiedByUserId: string | null;
  createdAt: string;
}

export interface CriterionStatus {
  roomId: string;
  criterionId: string;
  state: "PENDING" | "EVIDENCE_SUBMITTED" | "VERIFIED";
}

export interface SecurityAlert {
  id: string;
  roomId: string | null;
  organizationId: string | null;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  kind: string;
  detail: string;
  createdAt: string;
}

export interface IdempotencyRecord {
  key: string;
  scope: string;
  responseHash: string;
  responseBody: unknown;
  createdAt: string;
}

/**
 * Transactional outbox row for an outbound notification.
 *
 * Enqueued in the same flow as the event that caused it, then delivered by a
 * worker — so a mail-server outage can never fail or slow an API request, and
 * a crash cannot lose a notification.
 */
export interface NotificationRecord {
  id: string;
  kind: string;
  toEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  organizationId: string | null;
  roomId: string | null;
  /** Unique per logical notification; prevents duplicate sends. */
  dedupeKey: string;
  status: "PENDING" | "SENT" | "FAILED";
  attempts: number;
  /** Earliest time this should be delivered (used for reminders). */
  scheduledFor: string;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

export interface Session {
  token: string; // stored hashed in real DB; memory store keeps hash too
  userId: string;
  expiresAt: string;
}

export type { RoomEvent, AuditEvent, AuditCheckpoint };
