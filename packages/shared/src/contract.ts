import { z } from "zod";
import { DataCategory } from "./classification.js";

export const EVIDENCE_TYPES = [
  "tool_readback",
  "resource_reference",
  "test_result",
  "document",
  "checksum",
  "screenshot",
  "human_attestation",
  "external_verification",
] as const;
export const EvidenceType = z.enum(EVIDENCE_TYPES);
export type EvidenceType = z.infer<typeof EvidenceType>;

export const CompletionCriterion = z.object({
  id: z.string().min(1).max(64),
  description: z.string().min(1).max(2000),
  evidenceRequired: z.boolean().default(true),
  requiredEvidenceTypes: z.array(EvidenceType).default([]),
});
export type CompletionCriterion = z.infer<typeof CompletionCriterion>;

export const ContractParticipant = z.object({
  organization: z.string().min(1),
  role: z.enum(["customer", "provider", "peer"]),
});

/**
 * Machine-readable Task Contract. Both organizations must approve the exact
 * contract version before a room activates. Any change creates a new version
 * that must be re-approved by both sides.
 */
export const TaskContract = z.object({
  version: z.string().default("1.0"),
  objective: z.string().min(1).max(5000),
  participants: z.array(ContractParticipant).min(2).max(2),
  permittedDataClasses: z.array(DataCategory).default([]),
  forbiddenDataClasses: z.array(DataCategory).default([]),
  permittedActions: z.array(z.string().min(1).max(128)).default([]),
  approvalRequiredActions: z.array(z.string().min(1).max(128)).default([]),
  completionCriteria: z.array(CompletionCriterion).min(1),
});
export type TaskContract = z.infer<typeof TaskContract>;
