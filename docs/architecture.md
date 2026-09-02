# Architecture

## Overview

The platform creates **Secure Agent Rooms**: temporary trust boundaries in which two organizations' agents exchange exactly the information and authority a jointly approved Task Contract permits.

```
                        INTERNET
             +---------------------------+
             |    Web App (apps/web)     |
             +------------+--------------+
                          v
             +---------------------------+
             |  Control Plane (apps/api) |
             |  orgs / users / rooms /   |
             |  invites / contracts /    |
             |  policies / approvals     |
             +------------+--------------+
                          v
             +---------------------------+
             |  Room Orchestrator        |
             |  (packages/core)          |
             +------------+--------------+
              |                        |
     +--------v---------+    +---------v--------+
     | Participant path |    | Participant path |
     |  schema  → DLP   |    |  schema  → DLP   |
     |  → policy (PDP)  |    |  → policy (PDP)  |
     |  → approval gate |    |  → approval gate |
     +--------+---------+    +---------+--------+
              v                        v
        AgentAdapter A           AgentAdapter B
       (org A's agent)          (org B's agent)
```

## Control plane vs data plane

- **Control plane** (`apps/api` + `packages/core` identity/rooms services): accounts, organizations, memberships, rooms, invites, contracts, policies, approvals, connections.
- **Data plane** (`packages/core` pipeline/orchestrator): candidate events, validation, classification, DLP, policy enforcement, routing, budgets. The pipeline is a plain library today so it can be split into an independently deployable gateway later without API changes — every entry point is `submitCandidateEvent()`.

## Brokered collaboration

All agent communication is mediated by the orchestrator (spec §7). There is no peer networking. Benefits realized in code: centralized audit (`packages/audit` + `audit()` calls at every decision), one policy evaluation point, revocation by room state, per-room budgets, human approval interception.

## The enforcement pipeline

Every agent output enters `submitCandidateEvent()`:

1. **Schema validation** — `CandidateRoomEvent` (Zod discriminated union, hard size caps). Malformed output is dropped, never coerced.
2. **Structural filtering** — a `data_response` may only carry the exact fields the peer's `data_request` asked for; everything else is stripped (DLP layer 1, the best defense).
3. **Classification + DLP** — deterministic secret detectors, PII flags; the sender's declared classification can raise but never lower the computed result.
4. **Policy (PDP)** — deny-by-default engine (`packages/policy`) with hard platform floors first (secrets and credential categories never pass, in any configuration), then contract rules, then the participant's own disclosure policy.
5. **Outcome** — `deny` (policy_block event + audit + guidance back to the agent), `require_approval` (held approval bound to a parameter hash), or `allow` (persist envelope + route to the peer).

Trusted envelope fields (sequence, sender, classification, policy decision) are always server-assigned.

## Adapters

`AgentAdapter` (spec §66) is the seam for vendor neutrality:

- `ScriptedAgentAdapter` — deterministic; drives the demo and tests.
- `AnthropicAgentAdapter` — hosted agent (Mode B) via the official `@anthropic-ai/sdk`; strict JSON parsing of model output into candidate events; API key resolved from a credential vault at connect time, never stored.
- `A2AAgentAdapter` — native A2A (Mode A): `/.well-known/agent-card.json` discovery over the SSRF-safe fetcher, card schema validation, pinned card hash (change ⇒ `AgentCardChangedError` ⇒ reapproval), JSON-RPC `message/send`.

Adapters return **candidate events only**; nothing they emit is trusted.

## Storage

`Store` is an interface (`packages/database`). The in-memory implementation backs the MVP runtime and the entire test suite. `migrations/0001_init.sql` is the durable Postgres schema for the same entities, including append-only triggers on the audit table and row-level-security policies as defense-in-depth. Services never query without authorizing; the store itself is deliberately dumb.

## Future: private gateways (Mode D)

The pipeline's entry points take a `Ctx` (store + policy engine + signer + clock), so an organization-local gateway can run the same enforcement code inside a customer VPC and forward only approved payloads. Not built in the MVP; no architectural blocker.
