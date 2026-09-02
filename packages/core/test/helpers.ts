import type { ParticipantPolicy, TaskContract } from "@booth/shared";
import {
  approveContract,
  connectAgentToRoom,
  createAgentConnection,
  createCtx,
  createInvite,
  createRoom,
  proposeContract,
  redeemInvite,
  registerOrganization,
  setParticipantPolicy,
  startRoom,
  type Ctx,
} from "../src/index.js";

export const CONTRACT: TaskContract = {
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
  approvalRequiredActions: ["create_resource", "modify_resource", "delete_resource", "spend_money", "change_dns"],
  completionCriteria: [
    { id: "inventory", description: "Infrastructure inventory completed", evidenceRequired: true, requiredEvidenceTypes: ["tool_readback"] },
    { id: "plan", description: "Migration plan delivered", evidenceRequired: true, requiredEvidenceTypes: ["document"] },
  ],
};

export const OPEN_POLICY: ParticipantPolicy = {
  allowedEventTypes: [
    "message",
    "clarification_request",
    "clarification_response",
    "data_request",
    "data_response",
    "action_proposal",
    "action_result",
    "evidence_submission",
    "completion_proposal",
  ],
  dataClassRules: {
    architecture: "ALLOW",
    resource_inventory: "ALLOW",
    performance_metric: "ALLOW",
    infrastructure_metadata: "ALLOW",
    network_requirements: "ALLOW",
    source_code: "REQUIRE_APPROVAL",
    pii: "DENY",
    customer_data: "DENY",
  },
  maxAutoSensitivity: "CONFIDENTIAL",
  autonomousActions: ["read_inventory", "generate_migration_plan"],
  approvalRequiredActions: [],
};

export interface TestWorld {
  ctx: Ctx;
  roomId: string;
  orgA: { id: string; userId: string; participantId: string; connectionId: string };
  orgB: { id: string; userId: string; participantId: string; connectionId: string };
}

/** Build two orgs and drive a room all the way to ACTIVE. */
export async function setupActiveRoom(overrides?: {
  contract?: TaskContract;
  policyA?: ParticipantPolicy;
  policyB?: ParticipantPolicy;
  budget?: Partial<import("@booth/shared").ExecutionBudget>;
  /** Run against a specific store (e.g. PgStore) instead of the default. */
  store?: import("@booth/database").Store;
}): Promise<TestWorld> {
  const ctx = createCtx(overrides?.store ? { store: overrides.store } : {});
  // Unique emails so a shared durable database can host many test worlds.
  const nonce = Math.random().toString(36).slice(2, 10);
  const a = await registerOrganization(ctx, {
    orgName: "Acme",
    email: `alice-${nonce}@acme.example`,
    displayName: "Alice",
  });
  const b = await registerOrganization(ctx, {
    orgName: "CloudCo",
    email: `bob-${nonce}@cloudco.example`,
    displayName: "Bob",
  });

  const connA = await createAgentConnection(ctx, a.user.id, {
    organizationId: a.organization.id,
    name: "Migration Planner",
    adapterType: "SCRIPTED",
  });
  const connB = await createAgentConnection(ctx, b.user.id, {
    organizationId: b.organization.id,
    name: "Infrastructure Agent",
    adapterType: "SCRIPTED",
  });

  const { room } = await createRoom(ctx, a.user.id, {
    organizationId: a.organization.id,
    name: "Project Phoenix migration",
    budget: overrides?.budget,
  });
  const { token } = await createInvite(ctx, a.user.id, room.id, {});
  await redeemInvite(ctx, b.user.id, token, b.organization.id);

  await proposeContract(ctx, a.user.id, room.id, overrides?.contract ?? CONTRACT);
  await setParticipantPolicy(ctx, a.user.id, room.id, overrides?.policyA ?? OPEN_POLICY);
  await setParticipantPolicy(ctx, b.user.id, room.id, overrides?.policyB ?? OPEN_POLICY);
  await connectAgentToRoom(ctx, a.user.id, room.id, connA.id);
  await connectAgentToRoom(ctx, b.user.id, room.id, connB.id);
  await approveContract(ctx, a.user.id, room.id, 1);
  await approveContract(ctx, b.user.id, room.id, 1);
  await startRoom(ctx, a.user.id, room.id);

  const participants = await ctx.store.listParticipants(room.id);
  const partA = participants.find((p) => p.organizationId === a.organization.id)!;
  const partB = participants.find((p) => p.organizationId === b.organization.id)!;

  return {
    ctx,
    roomId: room.id,
    orgA: { id: a.organization.id, userId: a.user.id, participantId: partA.id, connectionId: connA.id },
    orgB: { id: b.organization.id, userId: b.user.id, participantId: partB.id, connectionId: connB.id },
  };
}
