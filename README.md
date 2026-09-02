# Secure Agent Rooms

**Secure cross-company AI collaboration.** Temporary, task-scoped, auditable rooms in which two organizations authorize their AI agents to exchange exactly the information and authority needed to complete a task — and nothing more.

> Organizations can allow their AI agents to collaborate across company boundaries without giving the other organization direct access to their internal systems, credentials, unrestricted context, or authority.

This repository is the MVP described in [spec.md](spec.md): a security product that happens to use AI, not an AI demo with security added afterward.

## Quickstart

**Run the whole product (Postgres + API + web) in containers:**

```bash
cp .env.example .env
# set BOOTH_AUDIT_KEY to 32+ random bytes: openssl rand -base64 48
docker compose up --build
```

Web on http://localhost:3000, API on http://localhost:4000 (OpenAPI at `/v1/openapi.json`). The API runs
migrations itself at boot. Cloud blueprints for Render and Fly.io are in [`deploy/`](deploy).

**Or develop locally** (Node ≥ 20, `corepack enable pnpm`):

```bash
pnpm install
pnpm test          # full suite incl. the security regression tests
pnpm demo          # scripted end-to-end demo (spec §81) — no API keys needed
pnpm api           # API on http://127.0.0.1:4000
pnpm web           # web UI on http://localhost:3000
```

**Then, in the UI — two forms and a click:**

1. **Sign up.** Your organization is created with a sandbox agent already connected, so nothing else is needed to run a room.
2. **Start a room.** Pick a template, name the task, enter your counterpart's email. That one form writes the task contract, sets your disclosure policy, connects your agent, records your approval, and emails the invitation.
3. **They accept.** Your counterpart reviews exactly what would be exchanged and clicks *Accept and set up* — which joins them, sets a matching policy, connects their agent, and approves the contract. The room is `READY`.

Start it, and the agents run automatically — including a blocked credential disclosure and an approval gate
that emails whoever has to decide. See the [product walkthrough PDF](docs/Secure-Agent-Rooms-Walkthrough.pdf).

## What the MVP does

- **Organizations, users, RBAC** with a swappable dev identity provider (production: external OIDC IdP).
- **Rooms** with the full lifecycle state machine (`DRAFT → … → CLOSED`, plus `QUARANTINED`).
- **Secure invitations**: 256-bit tokens, SHA-256 stored, single redemption, expiry, email/domain binding. An invite token alone can never read room content.
- **Machine-readable Task Contracts** with versioning and dual approval; any change voids prior approvals.
- **Per-participant disclosure policies** evaluated by a deny-by-default policy engine (OPA-compatible input document; Rego mirror included).
- **The secure event pipeline**: every agent output is a *candidate* event → schema validation → structural field filtering → secret/PII DLP → policy → block / human approval / persist+route. There is no other path into a room.
- **Hard platform floors** that no configuration can override: credentials, private keys, API keys, and auth tokens never cross the boundary — even with human approval.
- **Human approvals** bound to the exact parameter hash; single-use; org-scoped; expiring.
- **Evidence-based completion**: agent claims stay `CLAIMED` until a human verifies; dual human approval gates `COMPLETED`.
- **Budgets and loop detection** that pause runaway rooms.
- **Email notifications** from a durable outbox: pending approvals (with a reminder), invitations, completion proposals, and security alerts. Emails carry what needs attention and a link — never the proposed parameters or disclosed data.
- **Guided onboarding**: reusable room templates, a one-form launch that configures and invites, and a one-click accept for the invited side.
- **Tamper-evident audit**: hash-chained events + signed checkpoints, verified in tests and at room closure.
- **Server-side orchestration runtime** that drives every ACTIVE room: it builds each participant's adapter from its stored connection, runs turns, and stops for approvals, budgets, or failures — with provider errors surfaced to the humans in the room rather than leaving it silently idle.
- **Agent adapters** behind one interface: the zero-credential *sandbox agent*, hosted Claude, any OpenAI-compatible provider (OpenAI, Azure OpenAI, Gemini, self-hosted), and native A2A with agent-card hash pinning.
- **Tenant-scoped credentials**: references are derived server-side from a slug plus the organization id, so a connection can never be pointed at a platform secret or another tenant's key.
- **SSRF-safe fetching** for all agent-originated URL retrieval.

## Repository layout

```
packages/shared     ids, classification, task contract, typed events, room state machine
packages/dlp        layered secret + PII detection, classification merging
packages/policy     deny-by-default policy engine (PDP) + Rego mirror
packages/audit      canonical JSON, hash chain, signed checkpoints
packages/database   Store interface, in-memory + Postgres stores, schema/RLS, migration runner
packages/email      email templates and senders (SMTP / console / memory)
packages/agents     adapters (sandbox/Claude/OpenAI-compatible/A2A), factory, safeFetch, credential vault
packages/core       authorization, identity, teams, rooms, pipeline, approvals, orchestrator, runtime
apps/api            Fastify control-plane API (auth, idempotency, rate limits, SSE, OpenAPI, health/readiness)
apps/web            Next.js app: landing page, docs, dashboard, agents, team, room view, audit
apps/demo           scripted first demo (spec §81)
deploy/             Render and Fly.io blueprints
docs/               architecture, threat model, security invariants, GTM, walkthrough PDF
```

## Security posture (short version)

- LLM output never determines authorization. Policy decisions are deterministic TypeScript (OPA-swappable) evaluated outside the model.
- Remote agents, messages, files, and tool output are untrusted input, always.
- The store layer is dumb; every service call authorizes via central helpers; cross-tenant probes return `404`.
- Secrets exist only as `credential_reference` pointers resolved by the owning organization's adapter at call time.
- See [docs/security-invariants.md](docs/security-invariants.md) — each invariant maps to enforcing code and a regression test (`pnpm test:security`).

## Status

Beta-ready, and honest about the edges. Two rounds of multi-agent review (100 raw findings, 25 confirmed
after adversarial verification) drove the current state: the orchestration runtime, durable Postgres
storage, password authentication, team membership, containerized deployment, and a credential-scoping fix
that closed a real exfiltration path. **132 automated tests** run against both the in-memory and Postgres
stores, including real SMTP delivery verified end to end.

Known limits are documented rather than hidden: single API replica (in-process runtime, rate limiting and
idempotency), no OIDC yet, and no certifications. See
[docs/development.md](docs/development.md) and [docs/deployment.md](docs/deployment.md).

## Documents

- [Product walkthrough (PDF)](docs/Secure-Agent-Rooms-Walkthrough.pdf) — 18 pages, every screen from the running system
- [Go-to-market strategy](docs/gtm-strategy.md)
- [Threat model](docs/threat-model.md) · [Security invariants](docs/security-invariants.md) · [Architecture](docs/architecture.md)
