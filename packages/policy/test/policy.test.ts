import { describe, expect, it } from "vitest";
import { BuiltinPolicyEngine } from "../src/index.js";
import type { ParticipantPolicy, PolicyInput, TaskContract } from "@booth/shared";

const engine = new BuiltinPolicyEngine();

const contract: TaskContract = {
  version: "1.0",
  objective: "Migrate Project Phoenix to Azure",
  participants: [
    { organization: "Acme", role: "customer" },
    { organization: "CloudCo", role: "provider" },
  ],
  permittedDataClasses: ["architecture", "resource_inventory", "performance_metric", "infrastructure_metadata"],
  forbiddenDataClasses: ["credential", "private_key", "customer_data", "pii"],
  permittedActions: ["read_inventory", "generate_migration_plan"],
  approvalRequiredActions: ["change_dns", "create_resource", "spend_money"],
  completionCriteria: [{ id: "c1", description: "done", evidenceRequired: true, requiredEvidenceTypes: [] }],
};

const policy: ParticipantPolicy = {
  allowedEventTypes: [
    "message", "clarification_request", "clarification_response",
    "data_request", "data_response", "action_proposal", "action_result",
    "evidence_submission", "completion_proposal",
  ],
  dataClassRules: {
    architecture: "ALLOW",
    resource_inventory: "ALLOW",
    infrastructure_metadata: "ALLOW",
    performance_metric: "ALLOW",
    source_code: "REQUIRE_APPROVAL",
    pii: "DENY",
  },
  maxAutoSensitivity: "CONFIDENTIAL",
  autonomousActions: ["read_inventory", "generate_migration_plan"],
  approvalRequiredActions: [],
};

function input(partial: Partial<PolicyInput["event"]>, roomState = "ACTIVE"): PolicyInput {
  return {
    actor: { organizationId: "org_a", participantId: "part_a", agentConnectionId: "conn_a" },
    room: { id: "room_1", state: roomState },
    event: {
      type: "message",
      sensitivity: "INTERNAL",
      categories: ["general"],
      secretFindings: 0,
      ...partial,
    },
    recipient: { organizationId: "org_b", participantId: "part_b" },
  };
}

describe("BuiltinPolicyEngine", () => {
  it("allows an ordinary in-scope message", () => {
    expect(engine.evaluate(input({}), policy, contract).result).toBe("allow");
  });

  it("hard-denies any event containing secret findings, even if policy would allow", () => {
    const permissive: ParticipantPolicy = { ...policy, dataClassRules: { credential: "ALLOW" } as never };
    const d = engine.evaluate(input({ secretFindings: 1, categories: ["credential"] }), permissive, contract);
    expect(d.result).toBe("deny");
    expect(d).toMatchObject({ rule: "platform.secret_disclosure" });
  });

  it("hard-denies hard categories even without a regex hit", () => {
    const d = engine.evaluate(input({ categories: ["api_key"] }), policy, contract);
    expect(d.result).toBe("deny");
  });

  it("denies when the room is not active", () => {
    expect(engine.evaluate(input({}, "PAUSED"), policy, contract).result).toBe("deny");
    expect(engine.evaluate(input({}, "QUARANTINED"), policy, contract).result).toBe("deny");
  });

  it("denies contract-forbidden data classes", () => {
    const d = engine.evaluate(input({ type: "data_response", categories: ["customer_data"] }), policy, contract);
    expect(d).toMatchObject({ result: "deny", rule: "contract.forbidden_data_class" });
  });

  it("requires approval for approval-required actions", () => {
    const d = engine.evaluate(
      input({ type: "action_proposal", action: "change_dns" }),
      policy,
      contract,
    );
    expect(d.result).toBe("require_approval");
  });

  it("denies actions not in the contract at all", () => {
    const d = engine.evaluate(
      input({ type: "action_proposal", action: "delete_everything" }),
      policy,
      contract,
    );
    expect(d.result).toBe("deny");
  });

  it("requires approval for actions not on the participant autonomous allowlist", () => {
    const restrictive = { ...policy, autonomousActions: [] };
    const d = engine.evaluate(
      input({ type: "action_proposal", action: "read_inventory" }),
      restrictive,
      contract,
    );
    expect(d.result).toBe("require_approval");
  });

  it("denies data categories with no configured rule (deny by default)", () => {
    const d = engine.evaluate(input({ categories: ["business_strategy"] }), policy, contract);
    expect(d.result).toBe("deny");
  });

  it("requires approval for REQUIRE_APPROVAL categories", () => {
    const d = engine.evaluate(input({ categories: ["source_code"] }), policy, contract);
    expect(d.result).toBe("require_approval");
  });

  it("requires approval above the sensitivity ceiling", () => {
    const d = engine.evaluate(input({ sensitivity: "RESTRICTED", categories: ["architecture"] }), policy, contract);
    expect(d.result).toBe("require_approval");
  });

  it("denies data responses outside contract scope", () => {
    const d = engine.evaluate(
      input({ type: "data_response", categories: ["employee_data"] }),
      { ...policy, dataClassRules: { ...policy.dataClassRules, employee_data: "ALLOW" } },
      contract,
    );
    expect(d).toMatchObject({ result: "deny", rule: "contract.data_class_out_of_scope" });
  });
});
