import { z } from "zod";
import { Classification, DataCategory, SensitivityLevel } from "./classification.js";
import { EvidenceType } from "./contract.js";

/**
 * Typed room events. Natural-language chat is one event type among many;
 * structured events allow field-level authorization.
 *
 * Size caps are deliberate: agents must exchange scoped answers, not entire
 * context windows.
 */

const FieldName = z.string().min(1).max(128);
const ShortText = z.string().min(1).max(8_000);
const Purpose = z.string().min(1).max(1_000);

/** JSON scalar values allowed in structured data responses. */
const ScalarValue = z.union([z.string().max(4_000), z.number(), z.boolean(), z.null()]);
export const StructuredData = z.record(FieldName, ScalarValue).refine(
  (o) => Object.keys(o).length <= 64,
  { message: "too many fields" },
);
export type StructuredData = z.infer<typeof StructuredData>;

export const MessageBody = z.object({
  type: z.literal("message"),
  text: ShortText,
});

export const ClarificationRequestBody = z.object({
  type: z.literal("clarification_request"),
  question: ShortText,
});

export const ClarificationResponseBody = z.object({
  type: z.literal("clarification_response"),
  requestId: z.string().min(1),
  answer: ShortText,
});

export const DataRequestBody = z.object({
  type: z.literal("data_request"),
  purpose: Purpose,
  requestedFields: z.array(FieldName).min(1).max(64),
});

export const DataResponseBody = z.object({
  type: z.literal("data_response"),
  requestId: z.string().min(1),
  data: StructuredData,
});

export const ActionProposalBody = z.object({
  type: z.literal("action_proposal"),
  action: z.string().min(1).max(128),
  parameters: z.record(z.string().max(128), ScalarValue),
  reason: Purpose,
});

export const ActionResultBody = z.object({
  type: z.literal("action_result"),
  actionEventId: z.string().min(1),
  status: z.enum(["succeeded", "failed"]),
  summary: ShortText,
});

export const EvidenceSubmissionBody = z.object({
  type: z.literal("evidence_submission"),
  criterionId: z.string().min(1).max(64),
  evidenceType: EvidenceType,
  description: ShortText,
  reference: z.string().max(2_000).optional(),
});

export const CompletionProposalBody = z.object({
  type: z.literal("completion_proposal"),
  summary: ShortText,
});

export const CompletionResponseBody = z.object({
  type: z.enum(["completion_acceptance", "completion_rejection"]),
  reason: ShortText.optional(),
});

/** Events an agent may emit. This is the full trust boundary input surface. */
export const CandidateEventBody = z.discriminatedUnion("type", [
  MessageBody,
  ClarificationRequestBody,
  ClarificationResponseBody,
  DataRequestBody,
  DataResponseBody,
  ActionProposalBody,
  ActionResultBody,
  EvidenceSubmissionBody,
  CompletionProposalBody,
]);
export type CandidateEventBody = z.infer<typeof CandidateEventBody>;

export const CANDIDATE_EVENT_TYPES = [
  "message",
  "clarification_request",
  "clarification_response",
  "data_request",
  "data_response",
  "action_proposal",
  "action_result",
  "evidence_submission",
  "completion_proposal",
] as const;
export type CandidateEventType = (typeof CANDIDATE_EVENT_TYPES)[number];

/** System event types the server itself emits (never agents). */
export const SYSTEM_EVENT_TYPES = [
  "policy_block",
  "security_alert",
  "approval_request",
  "approval_response",
  "action_authorized",
  "action_rejected",
  "completion_acceptance",
  "completion_rejection",
  "room_pause",
  "room_resume",
  "room_close",
] as const;
export type SystemEventType = (typeof SYSTEM_EVENT_TYPES)[number];

export type RoomEventType = CandidateEventType | SystemEventType;

/**
 * A candidate event as proposed by an agent adapter. Untrusted until it has
 * passed schema validation, classification, DLP and policy.
 *
 * `declaredClassification` is the sender's own labeling — it can raise but
 * never lower the classification computed by the platform.
 */
export const CandidateRoomEvent = z.object({
  body: CandidateEventBody,
  declaredClassification: Classification.optional(),
});
export type CandidateRoomEvent = z.infer<typeof CandidateRoomEvent>;

/**
 * The internal secure event envelope. All trusted fields (sequence, ids,
 * policy decision, classification) are set by the server, never by clients.
 */
export interface RoomEvent {
  id: string;
  roomId: string;
  sequence: number;
  senderParticipantId: string | null; // null => platform/system
  recipientParticipantId: string | null;
  type: RoomEventType;
  createdAt: string;
  classification: {
    sensitivity: SensitivityLevel;
    categories: DataCategory[];
  };
  body: unknown;
  provenance: {
    agentId: string | null;
    connectorId: string | null;
    sourceTool: string | null;
  };
  policy: {
    policyVersion: string | null;
    decision: "allow" | "deny" | "require_approval" | "system";
  };
}

/** A room event with sensitive/internal fields removed, safe to show a participant agent. */
export interface SafeRoomEvent {
  id: string;
  sequence: number;
  senderParticipantId: string | null;
  type: RoomEventType;
  createdAt: string;
  body: unknown;
}
