import { describe, expect, it } from "vitest";
import { budgetExceeded, canTransition, escapeHtml, hashToken, newId, newSecretToken } from "../src/index.js";

describe("room state machine", () => {
  it("allows only whitelisted transitions", () => {
    expect(canTransition("DRAFT", "INVITED")).toBe(true);
    expect(canTransition("ACTIVE", "PAUSED")).toBe(true);
    expect(canTransition("DRAFT", "ACTIVE")).toBe(false);
    expect(canTransition("CLOSED", "ACTIVE")).toBe(false);
    expect(canTransition("COMPLETED", "ACTIVE")).toBe(false);
  });
});

describe("budget", () => {
  const budget = { maxTurns: 10, maxDurationMinutes: 60, maxToolCalls: 5, maxModelSpendUsd: 1 };
  it("reports the exceeded dimension", () => {
    expect(budgetExceeded(budget, { turns: 10, toolCalls: 0, startedAtMs: null, modelSpendUsd: 0 }, 0)).toBe("maxTurns");
    expect(budgetExceeded(budget, { turns: 0, toolCalls: 0, startedAtMs: 0, modelSpendUsd: 0 }, 61 * 60_000)).toBe("maxDurationMinutes");
    expect(budgetExceeded(budget, { turns: 0, toolCalls: 0, startedAtMs: null, modelSpendUsd: 0 }, 0)).toBeNull();
  });
});

describe("tokens", () => {
  it("generates 256-bit URL-safe tokens and stable hashes", () => {
    const t = newSecretToken();
    expect(t.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("prefixes ids", () => {
    expect(newId("room")).toMatch(/^room_[0-9a-f]{32}$/);
  });
});

describe("escapeHtml", () => {
  it("neutralizes markup", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });
});
