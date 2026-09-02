import type { TaskContract } from "./contract.js";
import type { ParticipantPolicy } from "./policy.js";

/**
 * Reusable task contracts and matching disclosure policies (spec §83).
 *
 * Authoring a contract from a blank form is the single biggest thing standing
 * between a new user and a working room, so every template ships a complete,
 * sensible contract AND a matching policy for both sides. Users can still edit
 * everything afterwards — a template is a starting point, not a constraint.
 */
export interface RoomTemplate {
  id: string;
  name: string;
  summary: string;
  /** Who typically starts this kind of room. */
  audience: string;
  objective: string;
  contract: Omit<TaskContract, "participants">;
  /** Policy applied to whichever side adopts the template. */
  policy: ParticipantPolicy;
}

const BASE_EVENT_TYPES = [
  "message",
  "clarification_request",
  "clarification_response",
  "data_request",
  "data_response",
  "action_proposal",
  "action_result",
  "evidence_submission",
  "completion_proposal",
];

export const ROOM_TEMPLATES: RoomTemplate[] = [
  {
    id: "cloud_migration",
    name: "Cloud migration",
    summary:
      "A provider plans and executes a migration using your infrastructure facts — without receiving credentials or making production changes unattended.",
    audience: "Cloud consultancies and MSPs working with a client",
    objective: "Produce and execute a complete cloud migration plan for the agreed application",
    contract: {
      version: "1.0",
      objective: "Produce and execute a complete cloud migration plan for the agreed application",
      permittedDataClasses: [
        "architecture",
        "resource_inventory",
        "infrastructure_metadata",
        "performance_metric",
        "network_requirements",
      ],
      forbiddenDataClasses: ["credential", "private_key", "customer_data", "pii", "source_code"],
      permittedActions: ["read_inventory", "generate_migration_plan", "run_health_check"],
      approvalRequiredActions: [
        "create_resource",
        "modify_resource",
        "delete_resource",
        "change_dns",
        "deploy_to_production",
        "spend_money",
      ],
      completionCriteria: [
        { id: "inventory", description: "Infrastructure inventory completed", evidenceRequired: true, requiredEvidenceTypes: ["tool_readback"] },
        { id: "plan", description: "Migration plan delivered and reviewed", evidenceRequired: true, requiredEvidenceTypes: ["document"] },
        { id: "backups", description: "Backups configured and verified", evidenceRequired: true, requiredEvidenceTypes: ["tool_readback"] },
      ],
    },
    policy: {
      allowedEventTypes: BASE_EVENT_TYPES,
      dataClassRules: {
        architecture: "ALLOW",
        resource_inventory: "ALLOW",
        infrastructure_metadata: "ALLOW",
        performance_metric: "ALLOW",
        network_requirements: "ALLOW",
        network_configuration: "REQUIRE_APPROVAL",
        source_code: "DENY",
        customer_data: "DENY",
        pii: "DENY",
      },
      maxAutoSensitivity: "CONFIDENTIAL",
      autonomousActions: ["read_inventory", "generate_migration_plan", "run_health_check"],
      approvalRequiredActions: [],
    },
  },
  {
    id: "vendor_security_review",
    name: "Vendor security review",
    summary:
      "A customer's security team collects and verifies evidence from a vendor, with every claim marked unverified until a human checks it.",
    audience: "Security teams reviewing a supplier",
    objective: "Complete the vendor security review and assemble a verified evidence package",
    contract: {
      version: "1.0",
      objective: "Complete the vendor security review and assemble a verified evidence package",
      permittedDataClasses: [
        "architecture",
        "infrastructure_metadata",
        "network_requirements",
        "resource_inventory",
      ],
      forbiddenDataClasses: ["credential", "private_key", "customer_data", "pii", "phi", "source_code"],
      permittedActions: ["read_inventory", "run_health_check"],
      approvalRequiredActions: ["create_resource", "modify_resource", "spend_money"],
      completionCriteria: [
        { id: "access_control", description: "Access control and authentication controls evidenced", evidenceRequired: true, requiredEvidenceTypes: ["document"] },
        { id: "encryption", description: "Encryption in transit and at rest evidenced", evidenceRequired: true, requiredEvidenceTypes: ["document"] },
        { id: "incident_response", description: "Incident response process evidenced", evidenceRequired: true, requiredEvidenceTypes: ["document"] },
      ],
    },
    policy: {
      allowedEventTypes: BASE_EVENT_TYPES,
      dataClassRules: {
        architecture: "ALLOW",
        infrastructure_metadata: "ALLOW",
        network_requirements: "ALLOW",
        resource_inventory: "ALLOW",
        network_configuration: "REQUIRE_APPROVAL",
        business_strategy: "DENY",
        customer_data: "DENY",
        employee_data: "DENY",
        pii: "DENY",
      },
      maxAutoSensitivity: "CONFIDENTIAL",
      autonomousActions: ["read_inventory", "run_health_check"],
      approvalRequiredActions: [],
    },
  },
  {
    id: "compliance_evidence",
    name: "Compliance evidence collection",
    summary:
      "An auditor gathers control evidence on a schedule of criteria, and the room only completes when both sides sign off on human-verified evidence.",
    audience: "Compliance and audit firms",
    objective: "Collect and verify control evidence for the agreed compliance framework",
    contract: {
      version: "1.0",
      objective: "Collect and verify control evidence for the agreed compliance framework",
      permittedDataClasses: ["architecture", "infrastructure_metadata", "resource_inventory", "performance_metric"],
      forbiddenDataClasses: ["credential", "private_key", "customer_data", "pii", "phi", "employee_data", "financial"],
      permittedActions: ["read_inventory"],
      approvalRequiredActions: ["create_resource", "modify_resource", "spend_money"],
      completionCriteria: [
        { id: "controls", description: "Control evidence collected for every in-scope control", evidenceRequired: true, requiredEvidenceTypes: ["document"] },
        { id: "gaps", description: "Identified gaps documented with remediation owners", evidenceRequired: true, requiredEvidenceTypes: ["document"] },
      ],
    },
    policy: {
      allowedEventTypes: BASE_EVENT_TYPES,
      dataClassRules: {
        architecture: "ALLOW",
        infrastructure_metadata: "ALLOW",
        resource_inventory: "ALLOW",
        performance_metric: "ALLOW",
        employee_data: "DENY",
        customer_data: "DENY",
        financial: "DENY",
        pii: "DENY",
      },
      maxAutoSensitivity: "CONFIDENTIAL",
      autonomousActions: ["read_inventory"],
      approvalRequiredActions: [],
    },
  },
  {
    id: "incident_remediation",
    name: "Pentest / incident remediation",
    summary:
      "A security provider works findings to closure with your team. Production changes always stop for a human.",
    audience: "Security providers and incident responders",
    objective: "Remediate the agreed findings and evidence each fix",
    contract: {
      version: "1.0",
      objective: "Remediate the agreed findings and evidence each fix",
      permittedDataClasses: ["architecture", "infrastructure_metadata", "network_requirements", "resource_inventory"],
      forbiddenDataClasses: ["credential", "private_key", "customer_data", "pii", "source_code"],
      permittedActions: ["read_inventory", "run_health_check"],
      approvalRequiredActions: [
        "modify_resource",
        "delete_resource",
        "change_firewall",
        "change_dns",
        "deploy_to_production",
        "rotate_secrets",
      ],
      completionCriteria: [
        { id: "fixes", description: "Each agreed finding remediated", evidenceRequired: true, requiredEvidenceTypes: ["test_result"] },
        { id: "retest", description: "Retest confirms the findings are closed", evidenceRequired: true, requiredEvidenceTypes: ["test_result"] },
      ],
    },
    policy: {
      allowedEventTypes: BASE_EVENT_TYPES,
      dataClassRules: {
        architecture: "ALLOW",
        infrastructure_metadata: "ALLOW",
        network_requirements: "ALLOW",
        resource_inventory: "ALLOW",
        network_configuration: "REQUIRE_APPROVAL",
        source_code: "DENY",
        customer_data: "DENY",
        pii: "DENY",
      },
      maxAutoSensitivity: "CONFIDENTIAL",
      autonomousActions: ["read_inventory", "run_health_check"],
      approvalRequiredActions: [],
    },
  },
  {
    id: "blank",
    name: "Start from scratch",
    summary: "An empty contract you fill in yourself. Credential classes stay blocked either way.",
    audience: "Anything the templates don't cover",
    objective: "Describe what the two agents should accomplish",
    contract: {
      version: "1.0",
      objective: "Describe what the two agents should accomplish",
      permittedDataClasses: ["architecture", "infrastructure_metadata"],
      forbiddenDataClasses: ["credential", "private_key", "customer_data", "pii"],
      permittedActions: [],
      approvalRequiredActions: ["create_resource", "modify_resource", "delete_resource", "change_dns", "spend_money"],
      completionCriteria: [
        { id: "criterion_1", description: "Describe how you will know the task is done", evidenceRequired: true, requiredEvidenceTypes: [] },
      ],
    },
    policy: {
      allowedEventTypes: BASE_EVENT_TYPES,
      dataClassRules: {
        architecture: "ALLOW",
        infrastructure_metadata: "ALLOW",
        customer_data: "DENY",
        pii: "DENY",
      },
      maxAutoSensitivity: "CONFIDENTIAL",
      autonomousActions: [],
      approvalRequiredActions: [],
    },
  },
] as RoomTemplate[];

export function findTemplate(id: string): RoomTemplate | undefined {
  return ROOM_TEMPLATES.find((t) => t.id === id);
}
