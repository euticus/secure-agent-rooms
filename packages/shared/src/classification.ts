import { z } from "zod";

/** Sensitivity levels, ordered from least to most sensitive. */
export const SENSITIVITY_LEVELS = [
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "RESTRICTED",
  "SECRET",
] as const;

export const SensitivityLevel = z.enum(SENSITIVITY_LEVELS);
export type SensitivityLevel = z.infer<typeof SensitivityLevel>;

export function sensitivityRank(level: SensitivityLevel): number {
  return SENSITIVITY_LEVELS.indexOf(level);
}

/** Semantic data categories used by policy and DLP. */
export const DATA_CATEGORIES = [
  "credential",
  "private_key",
  "api_key",
  "authentication_token",
  "pii",
  "phi",
  "financial",
  "source_code",
  "network_configuration",
  "infrastructure_metadata",
  "customer_data",
  "employee_data",
  "business_strategy",
  "architecture",
  "resource_inventory",
  "performance_metric",
  "network_requirements",
  "general",
] as const;

export const DataCategory = z.enum(DATA_CATEGORIES);
export type DataCategory = z.infer<typeof DataCategory>;

/**
 * Categories that may NEVER leave an organization boundary regardless of any
 * configured policy. Deterministic hard floor — not configurable, not
 * overridable by contract, policy, or (especially) model output.
 */
export const HARD_DENY_CATEGORIES: ReadonlySet<DataCategory> = new Set([
  "credential",
  "private_key",
  "api_key",
  "authentication_token",
]);

export const Classification = z.object({
  sensitivity: SensitivityLevel,
  categories: z.array(DataCategory),
});
export type Classification = z.infer<typeof Classification>;
