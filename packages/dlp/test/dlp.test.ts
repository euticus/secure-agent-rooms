import { describe, expect, it } from "vitest";
import { runDlp, scanTextForSecrets, scanTextForPii } from "../src/index.js";

describe("secret detection", () => {
  it("detects AWS access key IDs", () => {
    const findings = scanTextForSecrets("here you go: AKIAIOSFODNN7EXAMPLE");
    expect(findings.some((f) => f.detector === "aws_access_key_id")).toBe(true);
  });

  it("detects PEM private keys", () => {
    const findings = scanTextForSecrets("-----BEGIN RSA PRIVATE KEY-----\nMIIEow...");
    expect(findings.some((f) => f.category === "private_key")).toBe(true);
  });

  it("detects connection strings with embedded passwords", () => {
    const findings = scanTextForSecrets("postgres://admin:secret123@db.internal:5432/prod");
    expect(findings.some((f) => f.detector === "connection_string_password")).toBe(true);
  });

  it("detects password assignments", () => {
    expect(scanTextForSecrets("password=hunter2secret").length).toBeGreaterThan(0);
  });

  it("never includes raw secret material in findings", () => {
    const secret = "AKIAIOSFODNN7EXAMPLE";
    const findings = scanTextForSecrets(`key: ${secret}`);
    for (const f of findings) {
      expect(f.sample).not.toContain(secret);
      expect(JSON.stringify(f)).not.toContain(secret);
    }
  });

  it("does not flag ordinary infrastructure answers", () => {
    expect(scanTextForSecrets("PostgreSQL 16.3 running in eu-west-1, 840 GB")).toHaveLength(0);
  });
});

describe("pii detection", () => {
  it("flags emails and SSNs", () => {
    const f = scanTextForPii("contact jane.doe@example.com ssn 123-45-6789");
    expect(f.map((x) => x.detector)).toEqual(expect.arrayContaining(["email_address", "ssn"]));
  });

  it("flags Luhn-valid card numbers only", () => {
    expect(scanTextForPii("card 4111 1111 1111 1111").some((f) => f.detector === "payment_card")).toBe(true);
    expect(scanTextForPii("id 4111 1111 1111 1112").some((f) => f.detector === "payment_card")).toBe(false);
  });
});

describe("runDlp", () => {
  it("classifies secret-bearing bodies as SECRET", () => {
    const r = runDlp({ type: "message", text: "token ghp_0123456789abcdefghijklmnopqrstuvwxyz" });
    expect(r.classification.sensitivity).toBe("SECRET");
    expect(r.secretFindings.length).toBeGreaterThan(0);
  });

  it("declared classification can raise but not lower", () => {
    const r = runDlp(
      { type: "message", text: "AKIAIOSFODNN7EXAMPLE" },
      { sensitivity: "PUBLIC", categories: ["architecture"] },
    );
    expect(r.classification.sensitivity).toBe("SECRET");
    expect(r.classification.categories).toContain("architecture");
    expect(r.classification.categories).toContain("credential");
  });

  it("reassembles secrets split across sibling fields", () => {
    const r = runDlp({ type: "data_response", data: { a: "AKIA", b: "IOSFODNN7EXAMPLE" } });
    expect(r.secretFindings.some((f) => f.detector === "aws_access_key_id")).toBe(true);
  });

  it("does not false-positive on ordinary adjacent fields", () => {
    const r = runDlp({
      type: "data_response",
      data: { engine: "PostgreSQL", version: "16.3", region: "us-east-1", os: "Ubuntu 22.04" },
    });
    expect(r.secretFindings).toHaveLength(0);
  });

  it("scans nested structured data", () => {
    const r = runDlp({ type: "data_response", data: { db_url: "mysql://root:pw12345@10.0.0.5/x" } });
    expect(r.secretFindings.length).toBeGreaterThan(0);
  });
});
