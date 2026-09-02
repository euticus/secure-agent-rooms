import { randomUUID, randomBytes, createHash } from "node:crypto";

/**
 * Prefixed opaque IDs. UUIDv4 provides collision resistance; the prefix makes
 * IDs self-describing in logs and prevents cross-entity confusion.
 */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

/** 256 bits of cryptographically secure randomness, URL-safe. */
export function newSecretToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored only as SHA-256 hashes (hex). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Minimal HTML escaping for any surface that renders untrusted transcript text. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
