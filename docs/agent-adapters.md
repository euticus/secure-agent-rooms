# Agent Adapters

Interface (spec §66): `connect / capabilities / executeTurn / cancel / health / disconnect` in `packages/agents/src/types.ts`. Adapters translate between a vendor's agent surface and the room's candidate-event model. **Everything an adapter returns is untrusted** and enters the enforcement pipeline.

## Turn input (spec §67)

`AgentTurnInput` carries only what the participant may see: the task contract, up to 30 visible events, its open peer requests, completion state, remaining budget, and any policy guidance from a prior denial. Never other rooms, other orgs' internals, or platform state (context isolation, spec §34).

## Implemented

- **ScriptedAgentAdapter** — an ordered list of step functions; deterministic; used by the demo and the security suite.
- **AnthropicAgentAdapter** (Mode B, hosted) — official `@anthropic-ai/sdk`; model configurable per connection (default `claude-opus-5`); system prompt per spec §69 (defense-in-depth only); response must be a JSON `{"events": [...]}` and is strictly Zod-parsed — malformed output is dropped. The API key is resolved from a `CredentialVault` by reference at `connect()` and held only in adapter memory.
- **A2AAgentAdapter** (Mode A, native) — discovers `/.well-known/agent-card.json` via `safeFetch`, validates the card schema, and pins its canonical SHA-256 hash: any change raises `AgentCardChangedError` and requires human reapproval (rug-pull mitigation, spec §19). Exchanges JSON-RPC `message/send` with structured `data` parts; responses are strictly parsed into candidate events. The thin wire client sits behind the adapter boundary so it can be swapped for the official A2A SDK without touching the orchestrator (see docs/a2a.md).

## Planned (interface-compatible)

`OpenAIAgentAdapter`, `MCPBridgeAdapter` (Mode C: the room exposed as an MCP server with `room.*` tools), `PrivateGatewayAdapter` (Mode D).

## Credentials

`CredentialVault` (spec §28): the DB stores `credential_reference` strings (`env:NAME` in dev; cloud secret manager in production). Secret values never enter prompts, events, logs, or the store, and the API never returns the reference to clients.
