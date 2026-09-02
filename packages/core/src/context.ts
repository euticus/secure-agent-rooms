import { BuiltinPolicyEngine, type PolicyEngine } from "@booth/policy";
import { HmacCheckpointSigner, type CheckpointSigner } from "@booth/audit";
import { MemoryStore, PgStore, type Store } from "@booth/database";
import { resolveConfig, type BoothConfig } from "./config.js";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Shared wiring for all core services. */
export interface Ctx {
  store: Store;
  policyEngine: PolicyEngine;
  signer: CheckpointSigner;
  clock: Clock;
  config: BoothConfig;
}

export interface CtxOptions {
  store?: Store;
  policyEngine?: PolicyEngine;
  signer?: CheckpointSigner;
  clock?: Clock;
  checkpointKey?: Buffer;
  config?: BoothConfig;
}

export function createCtx(opts: CtxOptions = {}): Ctx {
  // resolveConfig fails closed: it throws rather than signing audit
  // checkpoints with a public dev key in production (see config.ts).
  const config = opts.config ?? resolveConfig(opts.checkpointKey ? { auditKey: opts.checkpointKey } : {});
  // Durable storage when DATABASE_URL is configured; the in-memory store is a
  // dev/test convenience only. Production refuses to start without a database.
  if (!opts.store && config.env === "production" && !config.databaseUrl) {
    throw new Error("DATABASE_URL is required in production — refusing to run on in-memory storage.");
  }
  const store =
    opts.store ??
    (config.databaseUrl
      ? new PgStore(config.databaseUrl, { ssl: /sslmode=require/.test(config.databaseUrl) })
      : new MemoryStore());
  return {
    store,
    policyEngine: opts.policyEngine ?? new BuiltinPolicyEngine(),
    signer: opts.signer ?? new HmacCheckpointSigner(config.auditKey),
    clock: opts.clock ?? systemClock,
    config,
  };
}
