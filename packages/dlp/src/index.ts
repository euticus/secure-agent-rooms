import type { Classification, DataCategory, SensitivityLevel } from "@booth/shared";
import { sensitivityRank } from "@booth/shared";
import { scanTextForSecrets, type SecretFinding } from "./secrets.js";
import { scanTextForPii, type PiiFinding } from "./pii.js";

export { scanTextForSecrets, scanTextForPii };
export type { SecretFinding, PiiFinding };

export interface DlpResult {
  secretFindings: SecretFinding[];
  piiFindings: PiiFinding[];
  /** Final classification: computed floor merged with any declared labels. */
  classification: Classification;
}

/** Extract every string in a JSON-ish value for scanning (keys included). */
export function extractStrings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8) return out;
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) extractStrings(v, out, depth + 1);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      extractStrings(v, out, depth + 1);
    }
  }
  return out;
}

/** Extract only string VALUES (no object keys), for split-secret reassembly. */
export function extractValueStrings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8) return out;
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) extractValueStrings(v, out, depth + 1);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) extractValueStrings(v, out, depth + 1);
  }
  return out;
}

const MAX_RUN = 4;

/**
 * Candidate reassemblies of a secret split across sibling fields.
 *
 * For each container, join contiguous runs of its immediate string values.
 * Sibling-scoped (rather than one global concatenation) so unrelated metadata
 * cannot break a match, and so matches stay anchored at run boundaries.
 */
export function reassemblyCandidates(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || value === null || typeof value !== "object") return out;
  const children = Array.isArray(value) ? value : Object.values(value);
  const siblingStrings = children.filter((v): v is string => typeof v === "string");
  for (let start = 0; start < siblingStrings.length; start++) {
    for (let len = 2; len <= MAX_RUN && start + len <= siblingStrings.length; len++) {
      out.push(siblingStrings.slice(start, start + len).join(""));
    }
  }
  if (siblingStrings.length > MAX_RUN) out.push(siblingStrings.join(""));
  for (const child of children) reassemblyCandidates(child, out, depth + 1);
  return out;
}

/**
 * Full DLP pass over an event body.
 *
 * The sender may declare a classification. Declared labels can only RAISE the
 * result (add categories / higher sensitivity) — an agent can never launder
 * content into a lower classification than the scanners computed.
 */
export function runDlp(body: unknown, declared?: Classification): DlpResult {
  const strings = extractStrings(body);
  const text = strings.join("\n");
  // Also scan reassembled sibling values: a secret deliberately split across
  // adjacent fields is rejoined here so chunking does not evade detection.
  // Structural field-filtering remains the primary defense (spec §21).
  const secretFindings = dedupeFindings([
    ...scanTextForSecrets(text),
    ...reassemblyCandidates(body).flatMap((c) => scanTextForSecrets(c)),
  ]);
  const piiFindings = scanTextForPii(text);

  const categories = new Set<DataCategory>();
  for (const f of secretFindings) categories.add(f.category);
  for (const f of piiFindings) categories.add(f.category);

  let sensitivity: SensitivityLevel = secretFindings.length > 0 ? "SECRET" : "INTERNAL";

  if (declared) {
    for (const c of declared.categories) categories.add(c);
    if (sensitivityRank(declared.sensitivity) > sensitivityRank(sensitivity)) {
      sensitivity = declared.sensitivity;
    }
  }
  if (categories.size === 0) categories.add("general");

  return {
    secretFindings,
    piiFindings,
    classification: { sensitivity, categories: [...categories] },
  };
}

function dedupeFindings(findings: SecretFinding[]): SecretFinding[] {
  const seen = new Set<string>();
  const out: SecretFinding[] = [];
  for (const f of findings) {
    const key = `${f.detector}:${f.category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}
