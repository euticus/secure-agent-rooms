import { describe, expect, it } from "vitest";
import {
  authenticate,
  checkSignupKey,
  createCtx,
  registerOrganization,
  resolveConfig,
  resolveSession,
} from "../../src/index.js";
import { hashPassword, validatePasswordStrength, verifyPassword } from "../../src/passwords.js";

// Dev auth off (as in production) without requiring a database for the test.
const NO_DEV_AUTH = () =>
  resolveConfig({ env: "test", auditKey: Buffer.alloc(32, 9), devAuthEnabled: false });

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password entirely", hash)).toBe(false);
  });

  it("produces a distinct hash per call (salted)", async () => {
    const a = await hashPassword("same-password-value");
    const b = await hashPassword("same-password-value");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password-value", a)).toBe(true);
  });

  it("never stores the plaintext", async () => {
    const hash = await hashPassword("super-secret-passphrase");
    expect(hash).not.toContain("super-secret-passphrase");
    expect(hash.startsWith("scrypt$")).toBe(true);
  });

  it("rejects malformed or absent stored hashes", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$1$2$3$4$5")).toBe(false);
  });

  it("enforces a minimum length", () => {
    expect(validatePasswordStrength("short")).toMatch(/at least/);
    expect(validatePasswordStrength("a-sufficiently-long-password")).toBeNull();
  });
});

describe("authentication", () => {
  async function prodCtx() {
    return createCtx({ config: NO_DEV_AUTH() });
  }

  it("authenticates a registered user and issues a working session", async () => {
    const ctx = await prodCtx();
    await registerOrganization(ctx, {
      orgName: "Acme",
      email: "a@acme.example",
      displayName: "A",
      password: "a-sufficiently-long-password",
    });
    const session = await authenticate(ctx, "a@acme.example", "a-sufficiently-long-password");
    expect((await resolveSession(ctx, session.token)).email).toBe("a@acme.example");
  });

  it("rejects a wrong password", async () => {
    const ctx = await prodCtx();
    await registerOrganization(ctx, {
      orgName: "Acme", email: "b@acme.example", displayName: "B", password: "a-sufficiently-long-password",
    });
    await expect(authenticate(ctx, "b@acme.example", "not-the-password")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("gives an identical error for unknown accounts (no enumeration)", async () => {
    const ctx = await prodCtx();
    await registerOrganization(ctx, {
      orgName: "Acme", email: "c@acme.example", displayName: "C", password: "a-sufficiently-long-password",
    });
    const wrongPassword = await authenticate(ctx, "c@acme.example", "nope-nope-nope").catch((e) => e);
    const unknownUser = await authenticate(ctx, "nobody@nowhere.example", "nope-nope-nope").catch((e) => e);
    expect(unknownUser.message).toBe(wrongPassword.message);
    expect(unknownUser.code).toBe(wrongPassword.code);
  });

  it("does real hashing work for unknown accounts (no timing oracle)", async () => {
    const ctx = await prodCtx();
    await registerOrganization(ctx, {
      orgName: "Acme", email: "t@acme.example", displayName: "T", password: "a-sufficiently-long-password",
    });
    // The dummy hash must be a VALID scrypt encoding, or verifyPassword would
    // return early without hashing and unknown accounts would answer faster.
    const timed = async (email: string) => {
      const t0 = process.hrtime.bigint();
      await authenticate(ctx, email, "some-wrong-password").catch(() => {});
      return Number(process.hrtime.bigint() - t0) / 1e6;
    };
    const known = await timed("t@acme.example");
    const unknown = await timed("nobody@nowhere.example");
    // Both paths run scrypt, so neither should be trivially fast.
    expect(known).toBeGreaterThan(1);
    expect(unknown).toBeGreaterThan(1);
  });

  it("requires a password when the dev IdP is disabled", async () => {
    const ctx = await prodCtx();
    await expect(
      registerOrganization(ctx, { orgName: "X", email: "d@x.example", displayName: "D" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects a weak password", async () => {
    const ctx = await prodCtx();
    await expect(
      registerOrganization(ctx, { orgName: "X", email: "e@x.example", displayName: "E", password: "short" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("closed-beta signup key", () => {
  it("allows any signup when unset", () => {
    delete process.env.BOOTH_SIGNUP_KEY;
    expect(checkSignupKey(undefined)).toBe(true);
  });

  it("requires an exact match when set", () => {
    process.env.BOOTH_SIGNUP_KEY = "beta-key-2026";
    try {
      expect(checkSignupKey("beta-key-2026")).toBe(true);
      expect(checkSignupKey("wrong-key")).toBe(false);
      expect(checkSignupKey(undefined)).toBe(false);
      expect(checkSignupKey("beta-key-2026-extra")).toBe(false);
    } finally {
      delete process.env.BOOTH_SIGNUP_KEY;
    }
  });
});
