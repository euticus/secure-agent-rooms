# Task Contract

Schema: `packages/shared/src/contract.ts` (spec §14). A contract declares the objective, the two participants, permitted/forbidden data classes, permitted and approval-required actions, and completion criteria (with required evidence types).

Rules enforced in code:

- Contracts are versioned; `PUT /v1/rooms/:id/contract` creates a new immutable version.
- **Any new version voids every participant's approval** — scope can never silently expand.
- Both organizations must approve the exact latest version before the room can become READY.
- The policy engine enforces the contract on every event: forbidden classes deny, out-of-scope disclosures deny, approval-required actions hold for humans, unknown actions deny.
- Completion criteria drive the checklist; `COMPLETION_PROPOSED` requires all evidence-required criteria to be at least EVIDENCE_SUBMITTED, and `COMPLETED` requires dual human approval.
