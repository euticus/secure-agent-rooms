# A2A

Mapping (spec §18):

| Platform concept | A2A concept |
|---|---|
| Secure Agent Room | Context (`contextId`) |
| Task Contract item | Task |
| Conversation event | Message |
| Evidence / output | Artifact |

Structured exchange uses A2A `data` parts carrying `{ events: [...] }` in the candidate-event schema; free text parts map to `message` events.

## Agent Card validation (spec §19)

On `connect()`: HTTPS-only fetch through the SSRF-safe fetcher, JSON schema validation, canonical SHA-256 hash pinned at approval time. Endpoint/skills/security changes ⇒ `AgentCardChangedError` ⇒ the connection flips to `NEEDS_REAPPROVAL` and a human must re-approve.

## Conformance status

The MVP ships a thin, schema-validated JSON-RPC client (`message/send`) behind the adapter boundary. Before external beta: swap in the official `@a2a-js/sdk` client and run the official A2A conformance tooling (spec §73). The adapter interface and orchestrator are unaffected by that swap.
