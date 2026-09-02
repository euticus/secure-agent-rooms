import { createCtx } from "@booth/core";
import { migrate } from "@booth/database";
import { buildApp } from "./app.js";

// createCtx() fails closed in production (throws without BOOTH_AUDIT_KEY or
// DATABASE_URL, and with dev auth enabled), so misconfiguration is caught here
// at startup rather than surfacing as 500s later.
const ctx = createCtx();
const { host, port, databaseUrl } = ctx.config;

// Run migrations before serving. Forward-only and idempotent, so this is safe
// on every boot and makes every container host correct — not just the ones
// whose blueprint happens to define a release command.
if (databaseUrl) {
  const applied = await migrate(databaseUrl);
  if (applied.length > 0) {
    console.log(`[booth] applied migrations: ${applied.join(", ")}`);
  }
}

const app = await buildApp({ ctx, logger: true, startRuntime: true });

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`received ${signal}, shutting down`);
  await app.close(); // stops the room runtime and drains in-flight requests
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Last-resort handlers: log deliberately instead of dying mid-write.
process.on("unhandledRejection", (reason) => {
  app.log.error({ reason: String(reason) }, "unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  app.log.fatal({ err }, "uncaught exception — exiting");
  process.exit(1);
});

await app.listen({ port, host });
app.log.info(`Secure Agent Rooms API listening on http://${host}:${port} (env=${ctx.config.env})`);
app.log.info(`OpenAPI: http://${host}:${port}/v1/openapi.json`);
