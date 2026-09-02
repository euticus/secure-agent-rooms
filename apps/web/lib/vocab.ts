/**
 * Shared UI vocabulary: human-readable labels + explanations for the policy
 * and contract concepts, so a non-expert can configure a room without knowing
 * the schema by heart.
 */
export interface DataClassInfo {
  id: string;
  label: string;
  help: string;
  /** Categories the platform blocks outright, regardless of configuration. */
  hardDenied?: boolean;
}

export const DATA_CLASSES: DataClassInfo[] = [
  { id: "architecture", label: "Architecture", help: "System design, diagrams, component relationships." },
  { id: "resource_inventory", label: "Resource inventory", help: "What resources exist: counts, types, sizes." },
  { id: "infrastructure_metadata", label: "Infrastructure metadata", help: "Non-secret infra details: versions, regions, engines." },
  { id: "performance_metric", label: "Performance metrics", help: "Throughput, latency, utilization figures." },
  { id: "network_requirements", label: "Network requirements", help: "Connectivity, bandwidth, and topology needs." },
  { id: "network_configuration", label: "Network configuration", help: "Firewall rules, subnets, routing details." },
  { id: "source_code", label: "Source code", help: "Application or infrastructure code." },
  { id: "business_strategy", label: "Business strategy", help: "Plans, roadmaps, commercial intent." },
  { id: "financial", label: "Financial data", help: "Costs, budgets, revenue figures." },
  { id: "customer_data", label: "Customer data", help: "Information about your customers." },
  { id: "employee_data", label: "Employee data", help: "Information about your staff." },
  { id: "pii", label: "Personal information (PII)", help: "Names, emails, phone numbers, addresses, IDs." },
  { id: "phi", label: "Health information (PHI)", help: "Medical or health-related personal data." },
  { id: "credential", label: "Credentials", help: "Passwords and login secrets.", hardDenied: true },
  { id: "private_key", label: "Private keys", help: "Cryptographic private key material.", hardDenied: true },
  { id: "api_key", label: "API keys", help: "Service API keys.", hardDenied: true },
  { id: "authentication_token", label: "Auth tokens", help: "Bearer/OAuth/session tokens.", hardDenied: true },
];

export const DISCLOSURE_RULES = [
  { id: "ALLOW", label: "Allow", help: "Your agent may share this automatically." },
  { id: "REQUIRE_APPROVAL", label: "Ask me", help: "A human on your side must approve each disclosure." },
  { id: "DENY", label: "Never", help: "Blocked entirely." },
] as const;

export const SENSITIVITY_LEVELS = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED", "SECRET"] as const;

export const EVENT_TYPES = [
  { id: "message", label: "Messages", help: "Free-text notes between agents." },
  { id: "clarification_request", label: "Clarification requests", help: "Ask the peer a question." },
  { id: "clarification_response", label: "Clarification responses", help: "Answer the peer's question." },
  { id: "data_request", label: "Data requests", help: "Ask for specific named fields." },
  { id: "data_response", label: "Data responses", help: "Return the requested fields." },
  { id: "action_proposal", label: "Action proposals", help: "Propose doing something consequential." },
  { id: "action_result", label: "Action results", help: "Report the outcome of an action." },
  { id: "evidence_submission", label: "Evidence", help: "Submit proof a criterion is met." },
  { id: "completion_proposal", label: "Completion proposals", help: "Propose the task is finished." },
];

/** Common consequential actions offered as suggestions in the wizard. */
export const COMMON_ACTIONS = [
  "read_inventory",
  "generate_migration_plan",
  "run_health_check",
  "create_resource",
  "modify_resource",
  "delete_resource",
  "change_dns",
  "change_firewall",
  "deploy_to_production",
  "rotate_secrets",
  "spend_money",
];

export const HIGH_RISK_ACTIONS = new Set([
  "create_resource",
  "modify_resource",
  "delete_resource",
  "change_dns",
  "change_firewall",
  "deploy_to_production",
  "rotate_secrets",
  "spend_money",
]);

export const ADAPTER_TYPES = [
  {
    id: "SCRIPTED",
    label: "Sandbox agent (no credentials)",
    help: "A built-in deterministic agent. Best for trying the product end to end without connecting an LLM.",
    needs: [] as const,
  },
  {
    id: "HOSTED_ANTHROPIC",
    label: "Claude (Anthropic API)",
    help: "We host the agent using your Anthropic API key.",
    needs: ["credentialReference"] as const,
  },
  {
    id: "HOSTED_OPENAI",
    label: "OpenAI-compatible (OpenAI, Azure OpenAI, Gemini, local)",
    help: "Any provider speaking the OpenAI Chat Completions API. Set the base URL for Azure/Gemini/self-hosted.",
    needs: ["credentialReference"] as const,
  },
  {
    id: "A2A_NATIVE",
    label: "Your own agent (A2A endpoint)",
    help: "Your agent exposes an A2A agent card. We pin its card hash; changes require re-approval.",
    needs: ["endpoint", "agentCardHash"] as const,
  },
];
