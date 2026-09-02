# Security Invariants

Spec §78. Every invariant names its enforcement point and the automated test that pins it. `pnpm test:security` runs the pinned suite.

1. **No remote participant receives information without passing outbound policy.**
   Enforcement: `submitCandidateEvent` is the only write path into a room's event stream for agent content; policy runs before persistence.
   Tests: `core/test/security/exfiltration.test.ts`, `core/test/flow.test.ts`.

2. **No LLM can directly modify its policy.**
   Enforcement: policy/contract mutation are human-authenticated control-plane APIs; the candidate-event schema has no policy surface; system event types are rejected from agents.
   Test: `escalation.test.ts` ("agents cannot emit policy/authorization event types").

3. **No credential is intentionally placed in model context where avoidable.**
   Enforcement: `CredentialVault` resolves references at call time inside the owning adapter; `AgentTurnInput` carries no credentials; DB stores `credential_reference` only, and the API strips it from responses.
   Test: DLP tests assert findings never carry secret material; code review of `identity.ts`/`anthropic.ts`.

4. **No consequential action executes without appropriate authorization.**
   Enforcement: contract `approvalRequiredActions` → held approval; unknown actions denied; participant autonomous allowlist.
   Tests: `approvals.test.ts` (bypass, cross-org approver).

5. **Every consequential action is auditable.**
   Enforcement: `audit()` at every decision point; hash-chained store.
   Tests: `flow.test.ts` (chain verification), `audit/test`.

6. **Every agent action is attributable** (organization, agent, room, human delegation).
   Enforcement: envelope `provenance` + server-assigned `senderParticipantId`; approvals record `decidedByUserId`.
   Test: `escalation.test.ts` (sender cannot be spoofed).

7. **Room credentials disappear after revocation/closure.**
   Enforcement: `closeRoom` invalidates pending approvals and unredeemed invites; sessions expire; adapter `disconnect()` drops resolved keys.
   Test: `flow.test.ts` (close path), `rooms.ts` review.

8. **An invite URL alone cannot read room content.**
   Enforcement: preview returns an authorization summary only, and requires authentication (+ binding).
   Test: `invites.test.ts`.

9. **One tenant cannot access another tenant's unrelated resources.**
   Enforcement: `requireMembership` / `requireRoomAccess` on every service entry; 404 on probes; Postgres RLS as depth.
   Tests: `tenant-isolation.test.ts`, `api/test/api.test.ts`.

10. **Remote content can never modify authorization simply by instructing an agent to do so.**
    Enforcement: same as 1+2 — authorization state is not reachable from any agent input path; hard floors are non-configurable.
    Test: `exfiltration.test.ts` (prompt injection scenario).

11. **A tenant can never resolve a credential it does not own.**
    Enforcement: credential references are *derived server-side* from a slug plus the organization id (`credentialReferenceFor`), never accepted raw from a client. `EnvCredentialVault` additionally refuses any variable outside the `BOOTH_CRED_` namespace and outside the caller's own organization prefix. This closes the exfiltration path where an admin could point a connection at `env:BOOTH_AUDIT_KEY` with an attacker-controlled provider `baseUrl` and receive the platform's own secret as a bearer token.
    Tests: `core/test/security/credentials.test.ts`, `api/test/api.test.ts` ("rejects agent connections that name a raw environment variable").

12. **A security alert is only ever visible to the organization it concerns.**
    Enforcement: alerts always carry an `organizationId` (room-wide events emit one per participant organization), and both stores filter strictly on it — there is no null-organization alert that every tenant would see.
    Test: production verification; `listSecurityAlerts` in both stores.

## Hard platform floors (non-configurable)

Regardless of contract, participant policy, or human approval:

- Content with secret-detector findings is denied (`platform.secret_disclosure`).
- The categories `credential`, `private_key`, `api_key`, `authentication_token` are denied (`platform.hard_deny_category`).
- Approved releases re-run the secret scan; a body that gains secret material after approval is refused and the approval invalidated (`approvals.test.ts`, "hard floor").
