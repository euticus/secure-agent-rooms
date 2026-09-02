/**
 * CORS behaviour probe.
 *
 * Run against one version of @fastify/cors, save the output, upgrade, run
 * again, diff. Any change in these headers is a change to a security boundary:
 * with `credentials: true`, an Access-Control-Allow-Origin echoed back to an
 * untrusted origin lets any website make authenticated requests as the user.
 *
 *   pnpm --filter @booth/api exec tsx test/cors-matrix.ts > /tmp/cors-v10.json
 */
import { buildApp } from "../src/app.js";
import { createCtx, resolveConfig } from "@booth/core";

const ALLOWED = "https://app.booth.example";

const ORIGINS: { label: string; origin: string | undefined }[] = [
  { label: "allowed origin", origin: ALLOWED },
  { label: "no Origin header (same-origin / curl)", origin: undefined },
  { label: "unrelated attacker origin", origin: "https://evil.example" },
  { label: "same host, different scheme", origin: "http://app.booth.example" },
  { label: "same host, explicit port", origin: "https://app.booth.example:443" },
  { label: "different port", origin: "https://app.booth.example:8443" },
  { label: "subdomain of allowed", origin: "https://evil.app.booth.example" },
  { label: "allowed as a prefix", origin: "https://app.booth.example.evil.com" },
  { label: "allowed as a suffix", origin: "https://evilapp.booth.example" },
  { label: "trailing slash", origin: `${ALLOWED}/` },
  { label: "uppercase host", origin: "https://APP.BOOTH.EXAMPLE" },
  { label: "null origin (sandboxed iframe)", origin: "null" },
  { label: "empty origin", origin: "" },
];

interface Probe {
  case: string;
  origin: string | null;
  method: string;
  status: number;
  allowOrigin: string | null;
  allowCredentials: string | null;
  allowMethods: string | null;
  allowHeaders: string | null;
  vary: string | null;
}

const app = await buildApp({
  ctx: createCtx({
    config: resolveConfig({
      env: "test",
      auditKey: Buffer.alloc(32, 3),
      devAuthEnabled: true,
      webOrigin: ALLOWED,
    }),
  }),
});

const results: Probe[] = [];

for (const { label, origin } of ORIGINS) {
  for (const method of ["OPTIONS", "GET"] as const) {
    const headers: Record<string, string> = {};
    if (origin !== undefined) headers.origin = origin;
    if (method === "OPTIONS") {
      headers["access-control-request-method"] = "POST";
      headers["access-control-request-headers"] = "content-type,authorization";
    }
    const res = await app.inject({
      method,
      // A real, authenticated endpoint — the thing an attacker would target.
      url: "/v1/me",
      headers,
    });
    results.push({
      case: label,
      origin: origin ?? null,
      method,
      status: res.statusCode,
      allowOrigin: res.headers["access-control-allow-origin"] as string ?? null,
      allowCredentials: res.headers["access-control-allow-credentials"] as string ?? null,
      allowMethods: res.headers["access-control-allow-methods"] as string ?? null,
      allowHeaders: res.headers["access-control-allow-headers"] as string ?? null,
      vary: res.headers["vary"] as string ?? null,
    });
  }
}

await app.close();

const pkg = await import("@fastify/cors/package.json", { with: { type: "json" } }).catch(() => null);
console.log(
  JSON.stringify(
    { corsVersion: (pkg as { default?: { version?: string } })?.default?.version ?? "unknown", allowedOrigin: ALLOWED, results },
    null,
    2,
  ),
);
