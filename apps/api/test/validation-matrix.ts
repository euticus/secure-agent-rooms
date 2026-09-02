/**
 * Request-validation behaviour probe.
 *
 * fastify-type-provider-zod compiles the zod schemas on every route into
 * Fastify validators, so it owns the API's entire input boundary. Run against
 * one version, save the output, upgrade, run again, diff. A case that flips
 * from rejected to accepted is a hole opening in that boundary.
 *
 *   pnpm --filter @booth/api exec tsx test/validation-matrix.ts > v4.json
 */
import { buildApp } from "../src/app.js";
import { createCtx, resolveConfig } from "@booth/core";

const app = await buildApp({
  ctx: createCtx({
    config: resolveConfig({ env: "test", auditKey: Buffer.alloc(32, 7), devAuthEnabled: true }),
  }),
});

// A real account, so authenticated routes get past the auth hook and actually
// reach validation.
const signup = await app.inject({
  method: "POST",
  url: "/v1/auth/register",
  payload: { orgName: "Probe Co", email: "probe@example.com", displayName: "Probe", password: "correct horse battery staple" },
});
const token = (signup.json() as { token?: string }).token;

interface Case {
  group: string;
  label: string;
  method: "GET" | "POST";
  url: string;
  payload?: unknown;
  auth?: boolean;
}

const CASES: Case[] = [
  // --- body: string constraints, formats, required-ness -------------------
  { group: "body", label: "valid signup", method: "POST", url: "/v1/auth/register", payload: { orgName: "A", email: "a@b.example", displayName: "D", password: "correct horse battery" } },
  { group: "body", label: "missing required field", method: "POST", url: "/v1/auth/register", payload: { email: "a@b.example", displayName: "D" } },
  { group: "body", label: "invalid email format", method: "POST", url: "/v1/auth/register", payload: { orgName: "A", email: "not-an-email", displayName: "D" } },
  { group: "body", label: "string over max(200)", method: "POST", url: "/v1/auth/register", payload: { orgName: "x".repeat(201), email: "a@b.example", displayName: "D" } },
  { group: "body", label: "empty string under min(1)", method: "POST", url: "/v1/auth/register", payload: { orgName: "", email: "a@b.example", displayName: "D" } },
  { group: "body", label: "wrong type (number for string)", method: "POST", url: "/v1/auth/register", payload: { orgName: 42, email: "a@b.example", displayName: "D" } },
  { group: "body", label: "null for required string", method: "POST", url: "/v1/auth/register", payload: { orgName: null, email: "a@b.example", displayName: "D" } },
  { group: "body", label: "array for string", method: "POST", url: "/v1/auth/register", payload: { orgName: ["a"], email: "a@b.example", displayName: "D" } },
  { group: "body", label: "nested object for string", method: "POST", url: "/v1/auth/register", payload: { orgName: { a: 1 }, email: "a@b.example", displayName: "D" } },
  { group: "body", label: "unknown extra key", method: "POST", url: "/v1/auth/register", payload: { orgName: "A", email: "a@b.example", displayName: "D", isAdmin: true } },
  { group: "body", label: "__proto__ key", method: "POST", url: "/v1/auth/register", payload: JSON.parse('{"orgName":"A","email":"a@b.example","displayName":"D","__proto__":{"x":1}}') },
  { group: "body", label: "body is an array", method: "POST", url: "/v1/auth/register", payload: [] },
  { group: "body", label: "body is a string", method: "POST", url: "/v1/auth/register", payload: '"hello"' },
  { group: "body", label: "optional field wrong type", method: "POST", url: "/v1/auth/register", payload: { orgName: "A", email: "a@b.example", displayName: "D", password: 123 } },

  // --- querystring: coercion is where zod versions differ most ------------
  { group: "query", label: "coerce: absent (optional)", method: "GET", url: "/v1/rooms/nope/events", auth: true },
  { group: "query", label: "coerce: valid integer", method: "GET", url: "/v1/rooms/nope/events?after=5", auth: true },
  { group: "query", label: "coerce: non-numeric", method: "GET", url: "/v1/rooms/nope/events?after=abc", auth: true },
  { group: "query", label: "coerce: negative (min 0)", method: "GET", url: "/v1/rooms/nope/events?after=-1", auth: true },
  { group: "query", label: "coerce: fractional (int)", method: "GET", url: "/v1/rooms/nope/events?after=1.5", auth: true },
  { group: "query", label: "coerce: empty value", method: "GET", url: "/v1/rooms/nope/events?after=", auth: true },
  { group: "query", label: "coerce: whitespace", method: "GET", url: "/v1/rooms/nope/events?after=%20", auth: true },
  { group: "query", label: "coerce: Infinity", method: "GET", url: "/v1/rooms/nope/events?after=Infinity", auth: true },
  { group: "query", label: "coerce: exponent form", method: "GET", url: "/v1/rooms/nope/events?after=1e3", auth: true },
  { group: "query", label: "coerce: hex form", method: "GET", url: "/v1/rooms/nope/events?after=0x10", auth: true },
  { group: "query", label: "coerce: repeated param", method: "GET", url: "/v1/rooms/nope/events?after=1&after=2", auth: true },
  { group: "query", label: "required string param present", method: "GET", url: "/v1/rooms?organizationId=org_1", auth: true },
  { group: "query", label: "required string param absent", method: "GET", url: "/v1/rooms", auth: true },
];

interface Result extends Omit<Case, "payload"> {
  status: number;
  code: string | null;
  message: string | null;
  /**
   * Not every 400 comes from the schema — handlers raise VALIDATION too (e.g.
   * MIN_PASSWORD_LENGTH). Only "schema" outcomes belong to the type provider,
   * so the two are separated rather than both counted as "rejected".
   */
  outcome: "schema-rejected" | "handler-rejected" | "passed-validation";
}

/** Handler-raised 400s quote a human sentence; schema errors name the field. */
function classify(status: number, message: string | null): Result["outcome"] {
  if (status !== 400) return "passed-validation";
  return /^(body|params|querystring|query)\b/i.test(message ?? "") ? "schema-rejected" : "handler-rejected";
}

const results: Result[] = [];
for (const c of CASES) {
  const res = await app.inject({
    method: c.method,
    url: c.url,
    ...(c.payload === undefined ? {} : { payload: c.payload as object }),
    headers: c.auth && token ? { authorization: `Bearer ${token}` } : {},
  });
  const body = res.json() as { error?: { code?: string; message?: string } };
  const message = body?.error?.message ?? null;
  results.push({
    group: c.group,
    label: c.label,
    method: c.method,
    url: c.url,
    auth: c.auth,
    status: res.statusCode,
    code: body?.error?.code ?? null,
    message,
    outcome: classify(res.statusCode, message),
  });
}

// The OpenAPI document is generated from the same schemas; a provider change
// can break generation without touching validation.
let openapi: { ok: boolean; paths: number; error: string | null };
try {
  const res = await app.inject({ method: "GET", url: "/v1/openapi.json" });
  const doc = res.json() as { paths?: Record<string, unknown> };
  openapi = { ok: res.statusCode === 200, paths: Object.keys(doc.paths ?? {}).length, error: null };
} catch (e) {
  openapi = { ok: false, paths: 0, error: String(e) };
}

await app.close();

const pkg = await import("fastify-type-provider-zod/package.json", { with: { type: "json" } }).catch(() => null);
const zod = await import("zod/package.json", { with: { type: "json" } }).catch(() => null);
console.log(JSON.stringify({
  provider: (pkg as { default?: { version?: string } })?.default?.version ?? "unknown",
  zod: (zod as { default?: { version?: string } })?.default?.version ?? "unknown",
  openapi,
  results,
}, null, 2));
