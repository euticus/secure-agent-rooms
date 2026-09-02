/**
 * First Demo (spec §81): AWS customer (Acme) working with an Azure migration
 * provider (CloudCo). Runs fully in-process with deterministic scripted
 * agents so it needs no API keys; swap ScriptedAgentAdapter for
 * AnthropicAgentAdapter to run live hosted agents.
 *
 *   pnpm demo
 */
import { ScriptedAgentAdapter } from "@booth/agents";
import type { ParticipantPolicy, TaskContract } from "@booth/shared";
import {
  RoomOrchestrator,
  approveCompletion,
  approveContract,
  closeRoom,
  completionStatus,
  connectAgentToRoom,
  createAgentConnection,
  createCtx,
  createInvite,
  createRoom,
  decideApproval,
  previewInvite,
  proposeContract,
  redeemInvite,
  registerOrganization,
  setParticipantPolicy,
  startRoom,
  submitCandidateEvent,
  verifyAudit,
  verifyEvidence,
} from "@booth/core";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const step = (n: number, s: string) => console.log(`\n${bold(`[${n}] ${s}`)}`);

const CONTRACT: TaskContract = {
  version: "1.0",
  objective: "Create a complete Azure migration plan for a small web application",
  participants: [
    { organization: "Acme", role: "customer" },
    { organization: "CloudCo", role: "provider" },
  ],
  permittedDataClasses: [
    "architecture",
    "resource_inventory",
    "performance_metric",
    "infrastructure_metadata",
    "network_requirements",
  ],
  forbiddenDataClasses: ["credential", "private_key", "customer_data", "pii"],
  permittedActions: ["read_inventory", "generate_migration_plan"],
  approvalRequiredActions: ["create_resource", "change_dns", "spend_money"],
  completionCriteria: [
    { id: "inventory", description: "Infrastructure inventory completed", evidenceRequired: true, requiredEvidenceTypes: ["tool_readback"] },
    { id: "plan", description: "Azure migration plan delivered", evidenceRequired: true, requiredEvidenceTypes: ["document"] },
  ],
};

const POLICY: ParticipantPolicy = {
  allowedEventTypes: [
    "message", "clarification_request", "clarification_response", "data_request",
    "data_response", "action_proposal", "action_result", "evidence_submission", "completion_proposal",
  ],
  dataClassRules: {
    architecture: "ALLOW",
    resource_inventory: "ALLOW",
    performance_metric: "ALLOW",
    infrastructure_metadata: "ALLOW",
    network_requirements: "ALLOW",
    pii: "DENY",
    customer_data: "DENY",
  },
  maxAutoSensitivity: "CONFIDENTIAL",
  autonomousActions: ["read_inventory", "generate_migration_plan"],
  approvalRequiredActions: [],
};

const ctx = createCtx();

console.log(bold("=== Secure Agent Rooms — first demo ==="));
console.log(dim("Acme (AWS customer) + CloudCo (Azure migration provider)"));

step(1, "Organizations register");
const acme = await registerOrganization(ctx, { orgName: "Acme", email: "alice@acme.example", displayName: "Alice" });
const cloudco = await registerOrganization(ctx, { orgName: "CloudCo", email: "bob@cloudco.example", displayName: "Bob" });
console.log(`  ${acme.organization.name} (${acme.organization.id})`);
console.log(`  ${cloudco.organization.name} (${cloudco.organization.id})`);

step(2, "Acme creates the room and the Task Contract");
const { room } = await createRoom(ctx, acme.user.id, {
  organizationId: acme.organization.id,
  name: "Migrate Project Phoenix to Azure",
  budget: { maxTurns: 40 },
});
await proposeContract(ctx, acme.user.id, room.id, CONTRACT);
console.log(`  room ${room.id}`);
console.log(dim(`  objective: ${CONTRACT.objective}`));

step(3, "Invitation generated (only its SHA-256 hash is stored)");
const { token } = await createInvite(ctx, acme.user.id, room.id, { targetDomain: "cloudco.example" });
console.log(dim(`  https://app.example.com/invite/${token.slice(0, 12)}…`));

step(4, "CloudCo authenticates, previews the authorization, and redeems");
const preview = await previewInvite(ctx, cloudco.user.id, token);
console.log(dim(`  "${preview.invitingOrganization} has invited you: ${preview.contractSummary?.objective}"`));
console.log(dim(`  forbidden to receive: ${preview.contractSummary?.forbiddenDataClasses.join(", ")}`));
await redeemInvite(ctx, cloudco.user.id, token, cloudco.organization.id);

step(5, "Both sides set disclosure policies, connect agents, approve the contract");
const connA = await createAgentConnection(ctx, acme.user.id, {
  organizationId: acme.organization.id, name: "Migration Planner", adapterType: "SCRIPTED",
});
const connB = await createAgentConnection(ctx, cloudco.user.id, {
  organizationId: cloudco.organization.id, name: "Infrastructure Agent", adapterType: "SCRIPTED",
});
await setParticipantPolicy(ctx, acme.user.id, room.id, POLICY);
await setParticipantPolicy(ctx, cloudco.user.id, room.id, POLICY);
await connectAgentToRoom(ctx, acme.user.id, room.id, connA.id);
await connectAgentToRoom(ctx, cloudco.user.id, room.id, connB.id);
await approveContract(ctx, acme.user.id, room.id, 1);
await approveContract(ctx, cloudco.user.id, room.id, 1);
console.log(green(`  room state: ${(await ctx.store.getRoom(room.id))?.state}`));

step(6, "Humans start the room");
await startRoom(ctx, acme.user.id, room.id);

const participants = await ctx.store.listParticipants(room.id);
const partA = participants.find((p) => p.organizationId === acme.organization.id)!;
const partB = participants.find((p) => p.organizationId === cloudco.organization.id)!;

step(7, "Agents collaborate: structured data request/response");
const planner = new ScriptedAgentAdapter("planner", [
  () => [{
    body: { type: "data_request", purpose: "determine migration strategy", requestedFields: ["database_engine", "database_version", "database_size_gb"] },
  }],
]);
const infra = new ScriptedAgentAdapter("infra", [
  (input) => {
    const pending = input.pendingRequests[0];
    if (!pending) return [];
    // Internally the tool result contained host, password, connection string —
    // only the requested, policy-approved fields are emitted.
    return [{
      body: {
        type: "data_response",
        requestId: pending.eventId,
        data: { database_engine: "PostgreSQL", database_version: "16.3", database_size_gb: 840 },
      },
      declaredClassification: { sensitivity: "CONFIDENTIAL", categories: ["infrastructure_metadata"] },
    }];
  },
]);
const orchestrator = new RoomOrchestrator(ctx, room.id, {
  onEvent: (result) => {
    if (result.status === "allowed") {
      console.log(`  ${green("→")} ${result.event.type}: ${dim(JSON.stringify(result.event.body).slice(0, 110))}`);
    }
  },
});
orchestrator.register(partA, planner);
orchestrator.register(partB, infra);
await orchestrator.runLoop(4);

step(8, "CloudCo's agent attempts to disclose a credential — automatic block");
const leak = await submitCandidateEvent(ctx, partB.id, {
  body: { type: "message", text: "The prod connection is postgres://admin:S3cretPass@db.internal:5432/phoenix" },
});
if (leak.status === "denied") {
  console.log(red(`  BLOCKED — ${leak.reason}`));
  console.log(dim(`  rule: ${leak.rule}`));
  console.log(dim(`  agent guidance: ${leak.guidance.split("\n")[0]}`));
}

step(9, "The agent answers with a safe alternative instead");
const safe = await submitCandidateEvent(ctx, partB.id, {
  body: { type: "message", text: "Connection details withheld by policy. Non-secret metadata: PostgreSQL 16.3, region us-east-1, private subnet." },
  declaredClassification: { sensitivity: "CONFIDENTIAL", categories: ["infrastructure_metadata"] },
});
console.log(`  ${safe.status === "allowed" ? green("allowed") : red(safe.status)}`);

step(10, "Production action proposed → held for human approval");
const dns = await submitCandidateEvent(ctx, partB.id, {
  body: {
    type: "action_proposal",
    action: "change_dns",
    parameters: { record: "api.phoenix.example.com", from: "52.1.2.3", to: "20.4.5.6" },
    reason: "Production cutover to Azure",
  },
});
if (dns.status === "requires_approval") {
  console.log(yellow(`  HELD FOR APPROVAL (${dns.approvalId})`));
  const approval = await decideApproval(ctx, cloudco.user.id, dns.approvalId, "approve");
  console.log(green(`  Bob approved the exact parameters → released event ${approval.status === "APPROVED" ? approval.eventId : ""}`));
}

step(11, "Evidence submitted for each completion criterion");
for (const [criterionId, evidenceType, description, reference] of [
  ["inventory", "tool_readback", "AWS inventory export: 12 resources catalogued", "arn:aws:s3:::phoenix-inventory/export-2026-08-27.json"],
  ["plan", "document", "Azure migration plan v1.0 delivered", "doc://migration-plan-v1"],
] as const) {
  const r = await submitCandidateEvent(ctx, partB.id, {
    body: { type: "evidence_submission", criterionId, evidenceType, description, reference },
    declaredClassification: { sensitivity: "INTERNAL", categories: ["infrastructure_metadata"] },
  });
  console.log(`  ${r.status === "allowed" ? green("✓") : red("✗")} ${criterionId}: ${description} ${dim("(CLAIMED)")}`);
}
for (const e of await ctx.store.listEvidence(room.id)) {
  await verifyEvidence(ctx, cloudco.user.id, room.id, e.id);
}
console.log(dim("  humans verified evidence → HUMAN_VERIFIED"));

step(12, "Completion proposed; checklist satisfied; dual human approval");
await submitCandidateEvent(ctx, partB.id, { body: { type: "completion_proposal", summary: "Migration plan complete and evidenced." } });
const status = await completionStatus(ctx, room.id);
for (const c of status.criteria) console.log(`  ${c.state === "VERIFIED" ? green("✓") : yellow("⚠")} ${c.description} [${c.state}]`);
await approveCompletion(ctx, acme.user.id, room.id);
await approveCompletion(ctx, cloudco.user.id, room.id);
console.log(green(`  room state: ${(await ctx.store.getRoom(room.id))?.state}`));

step(13, "Room closed; audit chain finalized and verified");
await closeRoom(ctx, acme.user.id, room.id);
const integrity = await verifyAudit(ctx);
const auditEvents = await ctx.store.listAuditEvents({ roomId: room.id });
console.log(`  audit events for room: ${auditEvents.length}`);
console.log(`  hash chain valid: ${integrity.chainValid ? green("yes") : red("NO")}`);
console.log(`  signed checkpoints valid: ${integrity.checkpointsValid ? green("yes") : red("NO")}`);
console.log(dim("\n  audit excerpt:"));
for (const e of auditEvents.slice(-8)) {
  console.log(dim(`   #${e.sequence} ${e.action} ${e.decision ?? ""} ${e.eventHash.slice(0, 12)}…`));
}

console.log(`\n${bold(green("Demo complete."))} No credentials or internal tool access crossed the organization boundary.`);
