# Audit

## Hash chain (spec §41)

Every audit event is canonicalized (RFC 8785-style: sorted keys, no whitespace, `undefined` dropped) and chained:

```
event_hash = SHA256(previous_hash + canonicalize(event_without_hashes))
```

`verifyChain` recomputes the chain and reports the first broken sequence. Tampering with content, order, or deletions is detectable (see `packages/audit/test`).

## Checkpoints

`checkpointAudit` signs `{id, createdAt, upToSequence, headHash}` — HMAC-SHA256 with a key from the environment in dev, behind a `CheckpointSigner` interface designed for cloud KMS/HSM asymmetric keys in production. A checkpoint is written at every room closure.

## Event catalog

ROOM_CREATED, INVITE_CREATED, INVITE_REDEEMED, PARTICIPANT_JOINED, AGENT_CONNECTED, CONTRACT_PROPOSED, POLICY_APPROVED, POLICY_CHANGED, ROOM_STARTED, MESSAGE_ALLOWED, MESSAGE_BLOCKED, MESSAGE_REJECTED_SCHEMA, ACTION_PROPOSED, ACTION_APPROVED, ACTION_REJECTED, EVIDENCE_CREATED, EVIDENCE_VERIFIED, COMPLETION_PROPOSED, COMPLETION_APPROVED, ROOM_COMPLETED, ROOM_CLOSED, ROOM_PAUSED_AUTOMATICALLY, SECURITY_ALERT, ORGANIZATION_CREATED, AGENT_CONNECTION_CREATED.

Events carry actor type/id, organization, room, resource, policy version, decision, and redacted metadata. Credentials and full restricted payloads are never logged; the API logger redacts Authorization/cookie/idempotency headers.

## Retention

Rooms carry independent `contentRetentionDays` and `auditRetentionDays` (spec §59). The MVP records them; enforcement jobs belong to the worker tier when Postgres is wired in.
