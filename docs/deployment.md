# Deployment

The stack is three services: **Postgres**, the **API**, and the **web app**. The API runs pending migrations itself at boot — before it accepts traffic — so every container host is correct, not just the ones whose blueprint defines a release command.

## Local / self-hosted (Docker Compose)

```bash
cp .env.example .env
# Set BOOTH_AUDIT_KEY to 32+ random bytes:
#   openssl rand -base64 48
docker compose up --build
```

Web on `http://localhost:3000`, API on `http://localhost:4000`, OpenAPI at `/v1/openapi.json`.

This runs in **production mode**, which is deliberately fail-closed:

- No `BOOTH_AUDIT_KEY` → the API refuses to start rather than signing audit checkpoints with a publicly-known key.
- No `DATABASE_URL` → refuses to start rather than silently running on in-memory storage that a restart would erase.
- `BOOTH_DEV_AUTH=true` → refuses to start; passwordless sign-in cannot exist in production.

## Cloud

Blueprints are in [`deploy/`](../deploy):

| Platform | Files | Notes |
|---|---|---|
| Render | `deploy/render.yaml` | Blueprint deploy; provisions Postgres and generates `BOOTH_AUDIT_KEY`. **[Step-by-step walkthrough →](render-setup.md)** |
| Fly.io | `deploy/fly.api.toml`, `deploy/fly.web.toml` | `fly postgres attach` supplies `DATABASE_URL`; set other secrets with `fly secrets set`. |

Any container host works — the images are plain Dockerfiles with no platform coupling.

**Pointing the front end at the API** is a runtime setting: set `API_BASE_URL`
on the web service and restart. The browser reads it from `/config.js` rather
than from a compiled-in constant, so no rebuild is needed. (`NEXT_PUBLIC_API_BASE`
still works as a build-time fallback for local development.)

**The one thing that will bite you:** the API must run on a plan that does not
sleep. Its background runtime is what advances agent turns and delivers
notifications, so an idle-suspended API means rooms quietly stop progressing.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `BOOTH_AUDIT_KEY` | production | HMAC key for audit checkpoint signatures. 32+ bytes. Rotating it invalidates existing checkpoint signatures (the hash chain itself still verifies). |
| `DATABASE_URL` | production | Postgres connection string. Append `?sslmode=require` for managed providers. |
| `BOOTH_ENV` | – | `production` \| `development` \| `test`. Defaults from `NODE_ENV`. |
| `BOOTH_DEV_AUTH` | – | Passwordless dev sign-in. Refused in production. |
| `BOOTH_SIGNUP_KEY` | – | When set, self-serve registration requires this exact key — the closed-beta gate. |
| `WEB_ORIGIN` | – | Browser origin allowed by CORS. |
| `API_BASE_URL` | web | Public API URL, served to the browser at runtime by `/config.js`. Changing it is a restart, not a rebuild. |
| `NEXT_PUBLIC_API_BASE` | – | Build-time fallback for the above; used in local development. |
| `BOOTH_RATE_LIMIT` | – | Authenticated requests/minute/user (default 600). |
| `BOOTH_ANON_RATE_LIMIT` | – | Unauthenticated requests/minute/IP (default 60). Raise it if a customer's whole team shares one egress IP. |
| `SMTP_HOST` / `SMTP_PORT` | for email | Mail server. Without a host, email notifications are off (the product still works; approvals just aren't emailed). |
| `SMTP_USER` / `SMTP_PASS` | – | SMTP credentials, when your provider requires them. |
| `EMAIL_FROM` | for email | From address. Use a domain you control with SPF/DKIM configured, or mail will land in spam. |
| `APP_URL` | for email | Public URL used to build links in emails. Falls back to `WEB_ORIGIN`. |
| `BOOTH_EMAIL` | – | `console` logs emails instead of sending; `off` disables them even with SMTP configured. |
| `HOST` / `PORT` | – | Bind address. Containers set `0.0.0.0`. |

## Migrations

```bash
DATABASE_URL=postgres://… pnpm --filter @booth/database run migrate
```

Forward-only, applied once each, tracked in `schema_migrations`. You rarely need to run this by hand: the API applies pending migrations at boot, and the compose file also runs them as a dedicated `migrate` service. Schema changes ship as **new** files in `packages/database/migrations` — never by editing an applied one.

## Email notifications

Approvals block work, so people need telling. The API queues every notification
in a durable outbox (`notifications` table) and a worker delivers it — a mail
outage can never fail an API request, and a restart cannot lose a message.

What gets sent: a pending approval (plus one reminder after four hours if it is
still undecided), a room invitation, a completion proposal, security alerts, and
a welcome on signup. Users can opt out per account; in-app notifications are
unaffected.

**What emails deliberately do not contain:** the proposed parameters, the
disclosed data, or the content that was blocked. Email is outside the trust
boundary and gets forwarded and archived, so notifications carry only what needs
attention and a link. The recipient signs in to see the rest.

`docker compose` includes [Mailpit](https://mailpit.axllent.org/) so you can see
notifications immediately at <http://localhost:8025>. For production, point
`SMTP_*` at a real provider and set `EMAIL_FROM` to a domain with SPF and DKIM
configured — transactional mail from a new domain lands in spam otherwise.

## Operational notes

- **Scaling:** run a **single API replica** — the blueprints pin this. The room-orchestration runtime, rate limiter, and idempotency cache are in-process, so a second replica would double-drive rooms and let two orchestrators each spend a room's budget. Horizontal scale needs Redis for the first three and a durable room-claim lock for the runner (see [development.md](development.md)).
- **Health:** `GET /healthz` is liveness (the process is up). `GET /readyz` is readiness — it touches the database, so an instance pointed at an unreachable or unmigrated database fails its probe instead of serving 500s. Point your platform's health check at `/readyz`.
- **Backups:** back up Postgres. The audit chain lives there, and it is the record you would hand an auditor.
- **TLS:** terminate at the edge (both platform blueprints force HTTPS).
- **Identity:** for production use behind an enterprise IdP, put OIDC in front and disable local registration with `BOOTH_SIGNUP_KEY`; the API only ever sees bearer sessions, so the swap is contained to the auth routes.
