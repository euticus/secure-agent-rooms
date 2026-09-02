# Threat Model

Threats follow spec §62. Each lists the implemented mitigations and the regression test that pins them.

| # | Threat | Mitigations (code) | Regression tests |
|---|--------|--------------------|------------------|
| T1 | Malicious peer agent requests secrets | Deny-by-default policy; hard platform floor on credential categories; secret DLP; structural field filtering (`packages/core/src/pipeline.ts`, `packages/policy`) | `core/test/security/exfiltration.test.ts` |
| T2 | Prompt injection via peer content | Peer content is data, never instructions; enforcement is outside the model; denial guidance never includes sensitive detail; adapter system prompt is defense-in-depth only | `exfiltration.test.ts` ("prompt injection…") |
| T3 | Compromised MCP tool / poisoned adapter output | All adapter output is candidate events through the full pipeline; strict Zod parsing drops anything malformed; A2A card pinning (`AgentCardChangedError`) | `escalation.test.ts`, `agents` card pinning |
| T4 | Stolen invite URL | Auth required before preview/redemption; 256-bit token, hash-only storage; expiry; single redemption; email/domain binding; token grants invitation view only | `invites.test.ts` |
| T5 | Stolen session/OAuth token | Sessions stored hashed, 12h expiry; production guidance: OIDC + RFC 9700 (PKCE, audience restriction, rotation) behind the identity abstraction | `api/test/api.test.ts` (401 paths) |
| T6 | Cross-tenant application bug | Central `requireMembership`/`requireRoomAccess` on every service call; cross-tenant probes return 404; Postgres RLS in schema as defense-in-depth | `tenant-isolation.test.ts`, API test |
| T7 | Runaway agents | Turn/spend/duration/tool budgets; loop detector (repeated near-identical exchanges); automatic pause + `room_pause` event | `budget.test.ts` |
| T8 | Malicious file | File ingestion is out of MVP scope; design in spec §35 (quarantine → scan → sanitize → classify → policy) reserved in the architecture | — (non-goal for MVP) |
| T9 | SSRF | `safeFetch`: HTTPS-only, DNS resolution checks, private/link-local/metadata ranges blocked, per-hop redirect re-validation, port/size/time limits | `ssrf.test.ts` |
| T10 | Replay | Idempotency-Key middleware; single-use approvals (`consumedAt`); single-redemption invites; server-assigned sequences | `approvals.test.ts`, API idempotency test |
| T11 | Audit log modification | SHA-256 hash chain over canonicalized events; signed checkpoints (HMAC now, KMS/HSM interface); Postgres append-only trigger | `audit/test/audit.test.ts` |
| T12 | Insider access | Least-privilege service surface; `credential_reference` never returned to clients; log redaction middleware; production separation guidance in docs/deployment.md | code review + `identity.ts` |

## T13 — Malicious tenant administrator (added after the second review)

An organization admin is trusted with their *own* organization, not with the platform. Two paths were found and closed:

| Vector | Mitigation |
|---|---|
| Point an agent connection at a platform secret (`env:BOOTH_AUDIT_KEY`, `env:DATABASE_URL`) with an attacker-controlled provider `baseUrl`, receiving it as a bearer token | Credential references are derived server-side from a slug + organization id; the vault refuses anything outside `BOOTH_CRED_` and outside the caller's own namespace |
| Read another organization's credential by naming its variable | Same namespace check, bound to the owning organization at adapter construction |
| Inject events as a low-privileged member or read-only auditor | The participant-events route requires an organization admin role |

Note the deliberate non-goal: an admin *may* point their own agent at any provider URL, including a self-hosted one. That is legitimate — a customer running a local model needs it — and is safe precisely because the credential they can attach is only ever their own.

## Prompt-injection stance (spec §22)

Every remote message, file, and tool result is **untrusted external content**. It can never modify system instructions, policies, tool definitions, authorization, task scope, or classifications, because none of those are writable through any agent-reachable surface: the only agent input path is `submitCandidateEvent`, whose schema contains no policy/authorization fields, and whose trusted envelope fields are server-assigned. The hosted-agent system prompt states the same rules, but is defense-in-depth only.

## Never-implement list (spec §63) — audit

- Entire context windows are never sent between agents: turn input is capped at 30 visible events plus scoped contract/completion state.
- No remote MCP access: adapters only see `AgentTurnInput`.
- No secrets in prompts: credential vault resolves at call time inside the owning org's adapter; DB stores references.
- No arbitrary shell execution anywhere.
- LLM JSON is validated (Zod) and dropped on mismatch.
- Agents cannot expand scopes: contract/policy changes are human-only APIs and void prior approvals.
- No auto-approved destructive actions: contract `approvalRequiredActions` + participant allowlists; unknown actions are denied.
- No unrestricted URL fetching: `safeFetch` only.
- Tool/adapter output is data, never instructions.
- Invite possession is not authorization: authentication + binding + org membership required.
- The LLM never judges its own message's safety: the pipeline does.
