import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createCtx, resolveConfig } from "@booth/core";

/**
 * CORS is a security boundary, and it is enforced by the browser rather than by
 * this server — so nothing else in the suite can detect it moving. A dependency
 * bump that changes origin matching (exploitable) or the advertised methods
 * (silently breaks the UI) leaves every other test green. These pin both.
 */

const ALLOWED = "https://app.booth.example";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({
    ctx: createCtx({
      config: resolveConfig({
        env: "test",
        auditKey: Buffer.alloc(32, 3),
        devAuthEnabled: true,
        webOrigin: ALLOWED,
      }),
    }),
  });
});

afterAll(async () => {
  await app.close();
});

function preflight(origin: string) {
  return app.inject({
    method: "OPTIONS",
    url: "/v1/me",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,authorization",
    },
  });
}

describe("CORS origin boundary", () => {
  it("advertises only the configured origin, never the caller's", async () => {
    const res = await preflight(ALLOWED);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  // The exploitable shape: if the server echoed the caller's origin back while
  // credentials are enabled, any website could read authenticated responses.
  it.each([
    ["an unrelated origin", "https://evil.example"],
    ["the same host over http", "http://app.booth.example"],
    ["a subdomain of the allowed host", "https://evil.app.booth.example"],
    ["the allowed host as a prefix", "https://app.booth.example.evil.com"],
    ["the allowed host as a suffix", "https://evilapp.booth.example"],
    ["a different port", "https://app.booth.example:8443"],
    ["a sandboxed iframe", "null"],
  ])("never reflects %s", async (_label, origin) => {
    for (const res of [await preflight(origin), await app.inject({ method: "GET", url: "/v1/me", headers: { origin } })]) {
      const acao = res.headers["access-control-allow-origin"];
      expect(acao).not.toBe(origin);
      expect(acao).not.toBe("*");
    }
  });
});

describe("CORS advertised methods", () => {
  // The team page changes a member's role with PATCH and removes a member with
  // DELETE. A default that omits them fails only in a real browser.
  it("advertises every method the web app actually sends", async () => {
    const res = await preflight(ALLOWED);
    const advertised = String(res.headers["access-control-allow-methods"] ?? "")
      .split(",")
      .map((m) => m.trim().toUpperCase());
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      expect(advertised).toContain(method);
    }
  });
});
