# Data Model

Entities (spec §42) live in `packages/database/src/types.ts`; the durable Postgres shape is `packages/database/migrations/0001_init.sql`.

## Core entities

- **organizations / users / organization_memberships** — org roles: owner, admin, security_admin, member, auditor.
- **agent_connections** — adapter type, endpoint, pinned `agent_card_hash`, opaque `credential_reference` (never a secret value), non-secret `config`.
- **rooms** — lifecycle state, budgets (`maxTurns/maxDurationMinutes/maxToolCalls/maxModelSpendUsd`), usage counters, per-room content/audit retention days.
- **room_participants** — one per organization per room; carries the participant's disclosure policy, agent binding, contract approval version, completion approval.
- **invites** — `token_hash` only (SHA-256 of a 256-bit token), expiry, single redemption, optional email/domain binding, revocation.
- **task_contract_versions** — immutable versions; a new version voids all participants' approvals.
- **room_events** — append-only, `(room_id, sequence)` unique, server-assigned envelope (classification, provenance, policy decision).
- **approvals** — held candidate body + `parameters_hash` binding, risk, org-scoped approver, expiry, single consumption.
- **evidence / criterion_statuses** — verification ladder CLAIMED → ATTESTED → SYSTEM_VERIFIED → HUMAN_VERIFIED; criterion states PENDING → EVIDENCE_SUBMITTED → VERIFIED.
- **audit_events** — global hash chain (`previous_hash`, `event_hash`), append-only (DB trigger refuses UPDATE/DELETE).
- **audit_checkpoints** — signed head (key id + signature).
- **security_alerts**, **idempotency_records**, **usage_records**.

## Tenancy

Every tenant-scoped table carries `organization_id` and/or `room_id` with FKs. Application-layer authorization is primary (services authorize before querying); RLS policies keyed on `booth.org_ids` session setting are defense-in-depth.

## Room state machine

```
DRAFT → INVITED → NEGOTIATING → READY → ACTIVE → COMPLETION_PROPOSED → COMPLETED → CLOSED
ACTIVE ⇄ PAUSED    ACTIVE/… → CANCELED → CLOSED    (security) → QUARANTINED → PAUSED/CANCELED/CLOSED
```

Transitions are whitelisted in `packages/shared/src/room.ts`; anything else is rejected.
