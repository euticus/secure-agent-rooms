import { z } from "zod";
import { DataCategory, SensitivityLevel } from "./classification.js";
import type { CandidateEventType } from "./events.js";

export type PolicyDecision =
  | { result: "allow" }
  | { result: "deny"; reason: string; rule: string }
  | { result: "require_approval"; reason: string; rule: string };

export const DisclosureRule = z.enum(["ALLOW", "DENY", "REQUIRE_APPROVAL"]);
export type DisclosureRule = z.infer<typeof DisclosureRule>;

/**
 * Per-participant policy: each organization decides what its own agent may
 * disclose and which actions require its humans' approval.
 */
export const ParticipantPolicy = z.object({
  /** Event types the participant's agent may emit. */
  allowedEventTypes: z.array(z.string()).min(1),
  /** Disclosure rule per semantic data category. Missing category => DENY. */
  dataClassRules: z.record(DataCategory, DisclosureRule),
  /** Maximum sensitivity that may leave this organization without approval. */
  maxAutoSensitivity: SensitivityLevel.default("CONFIDENTIAL"),
  /** Actions the agent may execute autonomously (must also be contract-permitted). */
  autonomousActions: z.array(z.string()).default([]),
  /** Actions requiring human approval (in addition to contract-level ones). */
  approvalRequiredActions: z.array(z.string()).default([]),
});
export type ParticipantPolicy = z.infer<typeof ParticipantPolicy>;

/**
 * The input document handed to the policy decision point (PDP). This shape is
 * deliberately OPA-compatible so the built-in engine can later be swapped for
 * an OPA sidecar without changing the enforcement point (PEP).
 */
export interface PolicyInput {
  actor: {
    organizationId: string;
    participantId: string;
    agentConnectionId: string | null;
  };
  room: {
    id: string;
    state: string;
  };
  event: {
    type: CandidateEventType;
    sensitivity: SensitivityLevel;
    categories: DataCategory[];
    action?: string;
    requestedFields?: string[];
    secretFindings: number;
  };
  recipient: {
    organizationId: string | null;
    participantId: string | null;
  };
}
