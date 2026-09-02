import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createCtx, resolveConfig } from "@booth/core";

/**
 * The request-validation boundary.
 *
 * fastify-type-provider-zod compiles every route's zod schema into a Fastify
 * validator, so it owns the whole input surface of the API. Upgrading it (or
 * zod underneath it) can weaken that surface without breaking anything else —
 * a schema that stops being enforced produces no error, just a request that
 * sails through. These cases pin the rejections themselves.
 *
 * Deliberately asserts only *that* a request is rejected with VALIDATION, not
 * the wording: zod and the provider both reword messages between majors, and a
 * test that pins prose would fail a safe upgrade while still missing an unsafe
 * one. What must not change is the accept/reject decision.
 */

let app: FastifyInstance;
let token: string | undefined;

beforeAll(async () => {
  app = await buildApp({
    ctx: createCtx({
      config: resolveConfig({ env: "test", auditKey: Buffer.alloc(32, 7), devAuthEnabled: true }),
    }),
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      orgName: "Boundary Co",
      email: "boundary@example.com",
      displayName: "Boundary",
      password: "correct horse battery",
    },
  });
  token = (res.json() as { token?: string }).token;
});

afterAll(async () => {
  await app.close();
});

async function reject(payload: unknown) {
  const res = await app.inject({ method: "POST", url: "/v1/auth/register", payload: payload as object });
  return { status: res.statusCode, code: (res.json() as { error?: { code?: string } })?.error?.code };
}

describe("body schemas reject malformed input", () => {
  it.each([
    ["a missing required field", { email: "a@b.example", displayName: "D" }],
    ["a malformed email", { orgName: "A", email: "not-an-email", displayName: "D" }],
    ["a string past its max", { orgName: "x".repeat(201), email: "a@b.example", displayName: "D" }],
    ["an empty string under min(1)", { orgName: "", email: "a@b.example", displayName: "D" }],
    ["a number where a string belongs", { orgName: 42, email: "a@b.example", displayName: "D" }],
    ["null where a string belongs", { orgName: null, email: "a@b.example", displayName: "D" }],
    ["an array where a string belongs", { orgName: ["a"], email: "a@b.example", displayName: "D" }],
    ["an object where a string belongs", { orgName: { a: 1 }, email: "a@b.example", displayName: "D" }],
    ["a wrongly-typed optional field", { orgName: "A", email: "a@b.example", displayName: "D", password: 123 }],
    ["an array as the whole body", []],
  ])("rejects %s", async (_label, payload) => {
    const { status, code } = await reject(payload);
    expect(status).toBe(400);
    expect(code).toBe("VALIDATION");
  });
});

describe("querystring schemas reject and coerce", () => {
  async function query(qs: string) {
    const res = await app.inject({
      method: "GET",
      url: `/v1/rooms/nonexistent/events${qs}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return res.statusCode;
  }

  // `after` is z.coerce.number().int().min(0).optional() — the paging cursor.
  it.each([
    ["a non-numeric cursor", "?after=abc"],
    ["a negative cursor", "?after=-1"],
    ["a fractional cursor", "?after=1.5"],
    ["a non-finite cursor", "?after=Infinity"],
    ["a repeated parameter", "?after=1&after=2"],
  ])("rejects %s", async (_label, qs) => {
    expect(await query(qs)).toBe(400);
  });

  // Validation runs before the handler, so reaching 404 proves the schema
  // accepted the input rather than the route silently not validating.
  it.each([
    ["an absent optional cursor", ""],
    ["a valid integer cursor", "?after=5"],
  ])("accepts %s", async (_label, qs) => {
    expect(await query(qs)).toBe(404);
  });

  it("rejects a request missing a required query parameter", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/rooms",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("OpenAPI generation", () => {
  // Generated from the same schemas, and it has broken independently of
  // validation before.
  it("still produces a document covering every route", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(res.statusCode).toBe(200);
    const doc = res.json() as { paths?: Record<string, unknown> };
    expect(Object.keys(doc.paths ?? {}).length).toBeGreaterThanOrEqual(40);
  });
});
