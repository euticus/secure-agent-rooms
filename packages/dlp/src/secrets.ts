import type { DataCategory } from "@booth/shared";

export interface SecretFinding {
  detector: string;
  category: DataCategory;
  /** Redacted sample — never contains the matched secret itself. */
  sample: string;
}

interface Detector {
  name: string;
  category: DataCategory;
  pattern: RegExp;
}

/**
 * Layer 2 — deterministic secret detection.
 *
 * These patterns are intentionally biased toward false positives: a blocked
 * disclosure is recoverable, a leaked credential is not. Findings never
 * include the matched value.
 */
const DETECTORS: Detector[] = [
  { name: "aws_access_key_id", category: "credential", pattern: /\b(AKIA|ASIA|AGPA|AROA|AIPA|ANPA)[0-9A-Z]{16}\b/ },
  { name: "aws_secret_access_key", category: "credential", pattern: /\baws_?secret[_a-z]*\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}\b/i },
  { name: "pem_private_key", category: "private_key", pattern: /-----BEGIN\s+(RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY( BLOCK)?-----/ },
  { name: "github_token", category: "authentication_token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/ },
  { name: "slack_token", category: "authentication_token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "stripe_key", category: "api_key", pattern: /\b[sr]k_(live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: "google_api_key", category: "api_key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "anthropic_api_key", category: "api_key", pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/ },
  { name: "openai_api_key", category: "api_key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "jwt", category: "authentication_token", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: "bearer_token", category: "authentication_token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/i },
  { name: "connection_string_password", category: "credential", pattern: /\b(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@/i },
  { name: "password_assignment", category: "credential", pattern: /\b(password|passwd|pwd)\b\s*[:=]\s*["']?[^\s"']{6,}/i },
  { name: "secret_assignment", category: "credential", pattern: /\b(client_secret|api[_-]?key|access[_-]?token|auth[_-]?token|secret[_-]?key)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{12,}/i },
  { name: "azure_sas", category: "authentication_token", pattern: /\bsig=[A-Za-z0-9%+/=]{32,}/ },
  { name: "ssh_key_material", category: "private_key", pattern: /\bssh-(rsa|ed25519|dss)\s+[A-Za-z0-9+/=]{60,}/ },
];

function redact(match: string): string {
  if (match.length <= 8) return "********";
  return `${match.slice(0, 4)}…[REDACTED ${match.length} chars]`;
}

/** Scan an arbitrary string for secret material. */
export function scanTextForSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const d of DETECTORS) {
    const m = d.pattern.exec(text);
    if (m) {
      findings.push({ detector: d.name, category: d.category, sample: redact(m[0]) });
    }
  }
  return findings;
}
