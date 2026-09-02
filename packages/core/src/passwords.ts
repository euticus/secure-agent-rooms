import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// Deliberately expensive; tuned for interactive login latency.
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 32;

/** Encoded as scrypt$N$r$p$salt$hash (all base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

/** Constant-time verification. Returns false for any malformed stored value. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const N = Number(nStr), r = Number(rStr), p = Number(pStr);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  try {
    const salt = Buffer.from(saltB64!, "base64url");
    const expected = Buffer.from(hashB64!, "base64url");
    const actual = await scrypt(password, salt, expected.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export const MIN_PASSWORD_LENGTH = 12;

export function validatePasswordStrength(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 512) return "Password is too long.";
  return null;
}
