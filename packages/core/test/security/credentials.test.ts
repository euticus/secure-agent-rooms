import { describe, expect, it } from "vitest";
import {
  CredentialAccessError,
  EnvCredentialVault,
  createAdapter,
  credentialEnvVar,
  credentialReferenceFor,
  safeProviderDetail,
} from "@booth/agents";

/**
 * Regression for the credential-exfiltration vector: an organization admin
 * could otherwise point an agent connection at a PLATFORM secret
 * (`env:BOOTH_AUDIT_KEY`) and an attacker-controlled provider base URL, and
 * the adapter would send that secret to them as a bearer token.
 */
describe("credential vault scoping", () => {
  const vault = new EnvCredentialVault();
  const ORG = "org_abc123";

  it("refuses to resolve platform secrets", async () => {
    process.env.BOOTH_AUDIT_KEY = "super-secret-audit-key-value-32bytes!";
    process.env.DATABASE_URL = "postgres://user:pw@db/booth";
    try {
      for (const ref of ["env:BOOTH_AUDIT_KEY", "env:DATABASE_URL", "env:PATH", "env:HOME"]) {
        await expect(vault.resolve(ref, ORG)).rejects.toBeInstanceOf(CredentialAccessError);
      }
    } finally {
      delete process.env.BOOTH_AUDIT_KEY;
      delete process.env.DATABASE_URL;
    }
  });

  it("refuses another organization's namespaced credential", async () => {
    const otherVar = credentialEnvVar("org_victim", "openai");
    process.env[otherVar] = "victim-key";
    try {
      await expect(vault.resolve(`env:${otherVar}`, ORG)).rejects.toBeInstanceOf(CredentialAccessError);
    } finally {
      delete process.env[otherVar];
    }
  });

  it("resolves the organization's own credential", async () => {
    const varName = credentialEnvVar(ORG, "openai");
    process.env[varName] = "my-own-key";
    try {
      expect(await vault.resolve(credentialReferenceFor(ORG, "openai"), ORG)).toBe("my-own-key");
    } finally {
      delete process.env[varName];
    }
  });

  it("rejects malformed and non-env references", async () => {
    await expect(vault.resolve("file:///etc/passwd", ORG)).rejects.toBeInstanceOf(CredentialAccessError);
    await expect(vault.resolve("env:BOOTH_CRED_X;rm -rf /", ORG)).rejects.toBeInstanceOf(CredentialAccessError);
  });

  it("does not echo the resolved variable name back to the caller", async () => {
    const err = await vault.resolve(credentialReferenceFor(ORG, "missing"), ORG).catch((e) => e);
    expect(String(err.message)).not.toContain("BOOTH_CRED_");
  });

  it("the factory binds the owning organization to every adapter", async () => {
    // A connection pointing at another org's credential cannot resolve it.
    const victimVar = credentialEnvVar("org_victim", "openai");
    process.env[victimVar] = "victim-key";
    try {
      const adapter = createAdapter(
        {
          id: "conn_1",
          organizationId: ORG,
          adapterType: "HOSTED_OPENAI",
          endpoint: null,
          agentCardHash: null,
          credentialReference: `env:${victimVar}`,
          config: { baseUrl: "https://attacker.example/v1" },
        },
        vault,
      );
      await expect(adapter.connect()).rejects.toBeInstanceOf(CredentialAccessError);
    } finally {
      delete process.env[victimVar];
    }
  });
});

describe("provider error redaction", () => {
  it("strips credential-shaped values from displayed provider errors", () => {
    const raw = 'Incorrect API key provided: sk-abcdef1234567890abcdef. Authorization: Bearer sk-live-9876543210abcdef';
    const safe = safeProviderDetail(raw);
    expect(safe).not.toContain("abcdef1234567890abcdef");
    expect(safe).not.toContain("9876543210abcdef");
    expect(safe).toContain("[REDACTED]");
  });

  it("truncates long provider bodies", () => {
    expect(safeProviderDetail("x".repeat(5000)).length).toBeLessThanOrEqual(300);
  });
});
