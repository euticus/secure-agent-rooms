# MCP

MCP is the agent-to-tool protocol on each organization's own side; A2A (brokered by the room) is agent-to-agent. The two are never conflated: remote agents get no MCP access, ever.

MVP status: organizations connect their own tools to their own agents outside the platform; what crosses the boundary is only pipeline-approved candidate events. The planned **Mode C (MCP Room Bridge)** exposes the room itself as an MCP server (`room.get_task`, `room.get_messages`, `room.respond`, `room.propose_action`, `room.submit_evidence`, `room.request_approval`, `room.propose_completion`) so existing AI environments can participate; it will sit behind the same `AgentAdapter` seam and the same enforcement pipeline.

Tool definition integrity (spec §24) is designed into `agent_connections` (`agent_card_hash` pinning today; tool schema fingerprints follow the same pattern when MCP connections land): unexpected change ⇒ DISABLE + reapproval + audit.
