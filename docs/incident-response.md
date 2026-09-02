# Incident Response (MVP runbook)

## Signals

- `security_alerts` rows / `GET /v1/security-alerts` (secret disclosure attempts, approval parameter mismatches, quarantines).
- Rooms in `QUARANTINED` (automatic after repeated secret-disclosure attempts) or auto-`PAUSED` (budget/loop).
- Audit chain verification failure (`GET /v1/rooms/:id/audit` → `integrity.chainValid=false`) — treat as critical.

## Immediate actions

1. Pause or quarantine the affected room (`POST /v1/rooms/:id/pause`); closing revokes outstanding approvals and invites.
2. Disable the implicated agent connection (status `DISABLED` / `NEEDS_REAPPROVAL`).
3. Rotate any credential whose *reference* was attached to the implicated connection (values never live in the platform, rotate at the source).
4. Export the room's audit slice before any remediation; verify the chain and checkpoint signatures.

## Post-incident

- Add a regression test reproducing the vector to `packages/core/test/security/`.
- If detection missed secret material, extend `packages/dlp` detectors (bias toward false positives).
- Record the incident and remediation in the audit log via a SECURITY_ALERT event.
