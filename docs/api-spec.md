# API

The control-plane API (`apps/api`) is versioned under `/v1` and generates OpenAPI from its Zod route schemas: **`GET /v1/openapi.json`**.

Authentication: `Authorization: Bearer <session token>` (dev IdP issues tokens via `/v1/auth/register` and `/v1/auth/dev-login`; production swaps in OIDC behind the same session abstraction). All state-changing routes honor `Idempotency-Key` (spec §46). Simple per-principal rate limiting is applied (Redis-backed in production).

| Method | Path | Purpose |
|---|---|---|
| POST | /v1/auth/register | Create org + owner user + session |
| POST | /v1/auth/dev-login | Dev session for an existing user |
| GET | /v1/me | Current user + org memberships |
| POST/GET | /v1/agent-connections | Manage agent connections (credential_reference never returned) |
| GET | /v1/security-alerts | Org-scoped alerts |
| POST/GET | /v1/rooms | Create / list rooms |
| GET | /v1/rooms/:roomId | Room detail (participants, contract, completion) |
| POST | /v1/rooms/:roomId/invites | Generate invite (token returned once) |
| GET | /v1/invites/:token | Preview invitation (authorization summary only) |
| POST | /v1/invites/:token/redeem | Join room |
| PUT | /v1/rooms/:roomId/contract | Propose contract version |
| POST | /v1/rooms/:roomId/contract/approve | Approve exact version |
| PUT | /v1/rooms/:roomId/policy | Set own participant policy |
| POST | /v1/rooms/:roomId/agent | Bind own agent connection |
| POST | /v1/rooms/:roomId/{start,pause,resume,cancel,close} | Lifecycle |
| GET | /v1/rooms/:roomId/events | Timeline (after=sequence for catch-up) |
| GET | /v1/rooms/:roomId/events/stream | SSE stream (durable state is source of truth) |
| POST | /v1/rooms/:roomId/participants/:id/events | Submit candidate event into the pipeline (own participant only) |
| GET | /v1/rooms/:roomId/approvals | List approvals |
| POST | /v1/approvals/:id/{approve,reject} | Decide (approver org only, single-use) |
| GET | /v1/rooms/:roomId/evidence | Evidence list |
| POST | /v1/rooms/:roomId/evidence/:id/verify | Human verification |
| POST | /v1/rooms/:roomId/completion/approve | Dual completion approval |
| GET | /v1/rooms/:roomId/audit | Room audit slice + chain integrity |

Error shape: `{ "error": { "code": "...", "message": "..." } }`. Cross-tenant probes return 404 (existence is tenant-scoped information).
