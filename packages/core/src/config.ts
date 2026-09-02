/**
 * Runtime configuration with fail-closed defaults.
 *
 * Security-sensitive settings (audit signing key, dev auth) must never
 * silently fall back to insecure development values in a hosted environment.
 * `resolveConfig` throws at startup rather than running a production instance
 * with a publicly-known key or an open impersonation endpoint.
 */
export type DeployEnv = "development" | "test" | "production";

export interface BoothConfig {
  env: DeployEnv;
  /** When true, the dev identity endpoints (register/dev-login) are live. */
  devAuthEnabled: boolean;
  /** HMAC key material for audit checkpoint signing. */
  auditKey: Buffer;
  /** Postgres connection string; when absent, an in-memory store is used. */
  databaseUrl: string | null;
  host: string;
  port: number;
  webOrigin: string;
}

const DEV_AUDIT_KEY = "dev-only-checkpoint-key-not-for-production!";

function resolveEnv(): DeployEnv {
  const raw = (process.env.BOOTH_ENV ?? process.env.NODE_ENV ?? "development").toLowerCase();
  if (raw === "production" || raw === "prod") return "production";
  if (raw === "test") return "test";
  return "development";
}

export function resolveConfig(overrides: Partial<BoothConfig> = {}): BoothConfig {
  const env = overrides.env ?? resolveEnv();
  const isProd = env === "production";

  // Audit key: fail closed in production.
  let auditKey: Buffer;
  if (overrides.auditKey) {
    auditKey = overrides.auditKey;
  } else if (process.env.BOOTH_AUDIT_KEY) {
    auditKey = Buffer.from(process.env.BOOTH_AUDIT_KEY, "utf8");
    if (auditKey.length < 32) {
      throw new Error("BOOTH_AUDIT_KEY must be at least 32 bytes");
    }
  } else if (isProd) {
    throw new Error(
      "BOOTH_AUDIT_KEY is required in production — refusing to sign audit checkpoints with a public dev key.",
    );
  } else {
    auditKey = Buffer.from(DEV_AUDIT_KEY, "utf8");
  }

  // Dev auth: OFF unless explicitly enabled with a truthy flag; never on in prod.
  const devFlag = (process.env.BOOTH_DEV_AUTH ?? "").toLowerCase();
  const devAuthRequested = devFlag === "true" || devFlag === "1" || devFlag === "yes";
  const devAuthDefault = env !== "production"; // dev/test default to enabled
  let devAuthEnabled = overrides.devAuthEnabled ?? (process.env.BOOTH_DEV_AUTH ? devAuthRequested : devAuthDefault);
  if (isProd && devAuthEnabled) {
    throw new Error("Dev auth (BOOTH_DEV_AUTH) cannot be enabled in production. Configure an external OIDC IdP instead.");
  }

  return {
    env,
    devAuthEnabled,
    auditKey,
    databaseUrl: overrides.databaseUrl ?? process.env.DATABASE_URL ?? null,
    host: overrides.host ?? process.env.HOST ?? (isProd ? "0.0.0.0" : "127.0.0.1"),
    port: overrides.port ?? Number(process.env.PORT ?? 4000),
    webOrigin: overrides.webOrigin ?? process.env.WEB_ORIGIN ?? "http://localhost:3000",
  };
}
