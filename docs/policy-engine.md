# Policy Engine

PDP/PEP separation (spec §9, §20): the **PDP** is `packages/policy` (`PolicyEngine` interface); the **PEP** is the pipeline in `packages/core/src/pipeline.ts`.

## Decision

```ts
type PolicyDecision =
  | { result: "allow" }
  | { result: "deny"; reason: string; rule: string }
  | { result: "require_approval"; reason: string; rule: string };
```

## Evaluation order (BuiltinPolicyEngine)

1. **Hard platform floors** (non-configurable): secret findings ⇒ deny; hard categories (`credential`, `private_key`, `api_key`, `authentication_token`) ⇒ deny; room not ACTIVE ⇒ deny.
2. **Contract rules**: forbidden data classes ⇒ deny; approval-required actions ⇒ require_approval; actions not in `permittedActions` ⇒ deny.
3. **Participant rules**: event type allowlist; per-category disclosure rules (missing category ⇒ **deny by default**); action autonomous allowlist (not listed ⇒ require_approval); sensitivity ceiling ⇒ require_approval; outbound disclosures must fit contract `permittedDataClasses`.

## OPA compatibility

`PolicyInput` is an OPA-style input document. `packages/policy/src/rego/room_policy.rego` mirrors the built-in engine; an `OpaHttpPolicyEngine` can be introduced behind the same interface (`ctx.policyEngine`) with participant policy + contract shipped as OPA `data`. The built-in TypeScript engine is authoritative for the MVP and is what the security regression suite pins.

## Denial guidance (spec §51–52)

Denials produce a `policy_block` room event (reason + rule, never the blocked content) and a bounded guidance string returned to the agent on its next turn so it can continue with permitted alternatives instead of deadlocking.
