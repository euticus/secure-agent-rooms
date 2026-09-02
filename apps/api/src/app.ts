import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import {
  AppError,
  NotificationDispatcher,
  RoomRuntimeManager,
  createCtx,
  resolveSession,
  type Ctx,
} from "@booth/core";
import type { User } from "@booth/database";
import { createHash } from "node:crypto";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerRoomRoutes } from "./routes/rooms.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerApprovalRoutes } from "./routes/approvals.js";
import { registerOnboardingRoutes } from "./routes/onboarding.js";

declare module "fastify" {
  interface FastifyInstance {
    runtime: RoomRuntimeManager;
    dispatcher: NotificationDispatcher;
    ctx: Ctx;
  }
  interface FastifyRequest {
    user: User;
    ctx: Ctx;
  }
}

const STATUS_BY_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  UNAUTHENTICATED: 401,
  VALIDATION: 400,
  CONFLICT: 409,
  STATE: 409,
  BUDGET_EXCEEDED: 429,
};

/** Fields that must never appear in logs (spec §55). */
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["idempotency-key"]',
  "req.headers['x-api-key']",
];

// Simple in-memory token bucket per principal. For a horizontally-scaled
// deployment this must move to Redis (documented scaling item); the bucket map
// is pruned periodically so it cannot grow without bound.
const buckets = new Map<string, { tokens: number; refilledAt: number }>();
/**
 * Authenticated default is generous because the UI polls several read
 * endpoints per room refresh; it still bounds abuse. Unauthenticated
 * endpoints get a much tighter budget (see the onRequest hook).
 */
const AUTHED_RATE_LIMIT = Number(process.env.BOOTH_RATE_LIMIT ?? 600);
function rateLimit(key: string, limit = AUTHED_RATE_LIMIT, windowMs = 60_000): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: limit, refilledAt: now };
  const refill = Math.floor((now - bucket.refilledAt) / windowMs) * limit;
  if (refill > 0) {
    bucket.tokens = Math.min(limit, bucket.tokens + refill);
    bucket.refilledAt = now;
  }
  if (bucket.tokens <= 0) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return true;
}
function pruneBuckets(windowMs = 60_000): void {
  const cutoff = Date.now() - windowMs * 5;
  for (const [k, v] of buckets) if (v.refilledAt < cutoff) buckets.delete(k);
}

// Live SSE stream count per user, to bound resource exhaustion.
const sseStreams = new Map<string, number>();
export const SSE_MAX_PER_USER = 5;
export function sseStreamState() {
  return { sseStreams, max: SSE_MAX_PER_USER };
}

export interface BuildAppOptions {
  ctx?: Ctx;
  logger?: boolean;
  /** Start the background room-orchestration runtime (default false in tests). */
  startRuntime?: boolean;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const ctx = opts.ctx ?? createCtx();

  const bucketPruner = setInterval(pruneBuckets, 60_000);
  if (typeof bucketPruner.unref === "function") bucketPruner.unref();
  const app = Fastify({
    logger: opts.logger
      ? { redact: { paths: REDACT_PATHS, censor: "[REDACTED]" } }
      : false,
    bodyLimit: 512 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  // The runtime logs through Fastify so failures are visible in production.
  const runtime = new RoomRuntimeManager(ctx, {
    logger: (msg, meta) => app.log.warn(meta ?? {}, `[room-runtime] ${msg}`),
  });
  // Delivers queued notifications from the durable outbox.
  const dispatcher = new NotificationDispatcher(ctx, {
    logger: (msg, meta) => app.log.warn(meta ?? {}, `[notifications] ${msg}`),
  });
  const store = ctx.store as { onPoolError?: (err: Error) => void };
  if (store && typeof store === "object") {
    store.onPoolError = (err) => app.log.error({ err }, "database pool error");
  }

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Many HTTP clients send `content-type: application/json` on bodyless POSTs
  // (e.g. /start, /pause, /approve). Treat an empty body as {} instead of
  // failing the request.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const raw = typeof body === "string" ? body.trim() : "";
    if (raw.length === 0) return done(null, {});
    try {
      done(null, JSON.parse(raw));
    } catch {
      done(new AppError("VALIDATION", "request body is not valid JSON"), undefined);
    }
  });

  await app.register(cors, {
    origin: ctx.config.webOrigin,
    credentials: true,
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Secure Agent Rooms API",
        description: "Control-plane API for cross-organization agent collaboration",
        version: "0.1.0",
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer" },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  app.decorateRequest("user");
  app.decorateRequest("ctx");
  app.decorate("runtime", runtime);
  app.decorate("dispatcher", dispatcher);
  app.decorate("ctx", ctx);

  if (opts.startRuntime) {
    runtime.start();
    dispatcher.start();
  }
  app.addHook("onClose", async () => {
    clearInterval(bucketPruner);
    await runtime.stop();
    await dispatcher.stop();
  });

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof AppError) {
      return reply
        .status(STATUS_BY_CODE[err.code] ?? 500)
        .send({ error: { code: err.code, message: err.message } });
    }
    const fastifyErr = err as { validation?: unknown; message?: string };
    if (fastifyErr.validation) {
      return reply
        .status(400)
        .send({ error: { code: "VALIDATION", message: fastifyErr.message ?? "invalid request" } });
    }
    app.log?.error?.(err);
    return reply.status(500).send({ error: { code: "INTERNAL", message: "internal error" } });
  });

  // Authentication + rate limiting for everything except public endpoints.
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    req.ctx = ctx;
    const url = req.url.split("?")[0] ?? "";
    if (url === "/healthz" || url === "/readyz" || url === "/v1/openapi.json" || url.startsWith("/v1/auth/")) {
      // Per-IP, and whole companies share an egress IP, so this is bounded but
      // not so tight that a team onboarding together trips it.
      if (!rateLimit(`anon:${req.ip}`, Number(process.env.BOOTH_ANON_RATE_LIMIT ?? 60))) {
        return reply.status(429).send({ error: { code: "RATE_LIMITED", message: "too many requests" } });
      }
      return;
    }
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "missing bearer token" } });
    }
    const token = header.slice(7);
    try {
      req.user = await resolveSession(ctx, token);
    } catch (e) {
      if (e instanceof AppError) {
        return reply.status(401).send({ error: { code: e.code, message: e.message } });
      }
      throw e;
    }
    if (!rateLimit(`user:${req.user.id}`)) {
      return reply.status(429).send({ error: { code: "RATE_LIMITED", message: "too many requests" } });
    }
  });

  // Idempotency for state-changing requests (spec §46).
  app.addHook("preHandler", async (req, reply) => {
    if (req.method !== "POST" && req.method !== "PUT") return;
    // Never cache unauthenticated requests (no principal to scope to) or auth
    // endpoints (their responses mint session tokens). Caching either could
    // return one principal's token/response to another.
    if (!req.user) return;
    if ((req.url.split("?")[0] ?? "").startsWith("/v1/auth/")) return;
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || key.length === 0 || key.length > 200) return;
    const scope = `${req.user.id}:${req.method}:${req.url.split("?")[0]}`;
    const existing = await ctx.store.getIdempotency(scope, key);
    if (existing) {
      reply.header("idempotency-replayed", "true");
      return reply.status(200).send(existing.responseBody);
    }
    // Capture the response on send.
    (req as FastifyRequest & { idem?: { scope: string; key: string } }).idem = { scope, key };
  });

  app.addHook("onSend", async (req, reply, payload) => {
    const idem = (req as FastifyRequest & { idem?: { scope: string; key: string } }).idem;
    if (idem && reply.statusCode >= 200 && reply.statusCode < 300 && typeof payload === "string") {
      try {
        await ctx.store.saveIdempotency({
          scope: idem.scope,
          key: idem.key,
          responseHash: createHash("sha256").update(payload).digest("hex"),
          responseBody: JSON.parse(payload),
          createdAt: new Date().toISOString(),
        });
      } catch {
        // non-JSON payloads are not cached
      }
    }
    return payload;
  });

  // Liveness only — the process is up.
  app.get("/healthz", async () => ({ ok: true }));

  // Readiness: proves the database is reachable AND migrated, so a deployment
  // against an empty database fails its probe instead of serving 500s.
  app.get("/readyz", async (_req, reply) => {
    try {
      await ctx.store.auditHead();
      return { ok: true, storage: ctx.config.databaseUrl ? "postgres" : "memory" };
    } catch (err) {
      app.log.error({ err }, "readiness check failed");
      return reply.status(503).send({ ok: false, error: "storage unavailable" });
    }
  });
  app.get("/v1/openapi.json", async () => app.swagger());

  await registerAuthRoutes(app, ctx);
  await registerRoomRoutes(app, ctx);
  await registerEventRoutes(app, ctx);
  await registerApprovalRoutes(app, ctx);
  await registerOnboardingRoutes(app, ctx);

  return app;
}
