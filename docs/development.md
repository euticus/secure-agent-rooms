# Development

```bash
pnpm install
pnpm test            # all packages
pnpm test:security   # the pinned security regression suite
pnpm typecheck
pnpm demo            # spec §81 demo, no keys needed
pnpm api             # http://127.0.0.1:4000
pnpm web             # http://localhost:3000 (NEXT_PUBLIC_API_BASE to point elsewhere)
```

Environment: `BOOTH_AUDIT_KEY` (checkpoint HMAC key), `BOOTH_DEV_AUTH=false` to disable dev login, `ANTHROPIC_API_KEY` + a connection with `credentialReference: "env:ANTHROPIC_API_KEY"` for live hosted agents, `WEB_ORIGIN` for CORS.

## Known limits (deliberate, documented)

- **Single API replica.** The room-orchestration runtime, rate limiter, and idempotency cache are in-process. Two replicas would double-drive rooms and let each spend a room's budget. Horizontal scale needs Redis (rate limit, idempotency, SSE fan-out) plus a durable room-claim lock. Blueprints pin one instance.
- **Notifications are email + in-app.** Pending approvals, invitations, completion proposals and security alerts are emailed from a durable outbox (with one approval reminder after four hours), and a badge in the nav shows anything awaiting your organization. There are no webhooks or Slack delivery yet, and no digest — each event is its own message.
- **Identity**: built-in password auth (scrypt, no enumeration). External OIDC is the enterprise path and slots in behind the same session abstraction (spec §25); SCIM and MFA are not implemented.
- **OPA**: the PDP is a deterministic TypeScript engine with an OPA-compatible input document and a Rego mirror; an OPA sidecar is a drop-in behind `PolicyEngine`.
- **A2A**: thin schema-validated wire client rather than the official SDK, and the agent-card hash must be supplied when creating a connection (no discovery-and-confirm flow yet). See docs/a2a.md.
- **Roles**: `owner`/`admin`/`security_admin` are administrative; `member`/`auditor` are read-only. A finer capability matrix (e.g. only security_admin decides approvals) is not implemented.
- **Files, Redis, worker tier, OpenTelemetry, private gateway**: not built (spec non-goals or later phases).

## Conventions

- Zod-validate every external input; no `any` at trust boundaries.
- Services authorize before touching the store — never add a store call in a route.
- Every new decision point must write an audit event and, if security-relevant, a regression test.
