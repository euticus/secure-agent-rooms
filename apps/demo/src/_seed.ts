/**
 * Seeds a realistic two-company scenario in the running deployment so the UI
 * can be captured mid-flow: an active room with agent traffic, a blocked
 * credential disclosure, and a pending human approval.
 */
const API = process.env.SEED_API ?? "http://localhost:4000";
const PW = "a-sufficiently-long-password";
const n = process.env.SEED_TAG ?? "demo";

async function call<T = any>(path: string, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${res.status} ${path}: ${JSON.stringify(data)}`);
  return data as T;
}

const acme = await call("/v1/auth/register", { method: "POST", body: { orgName: "Northwind Freight", email: `dana-${n}@northwind.example`, displayName: "Dana Reed", password: PW } });
const cloudco = await call("/v1/auth/register", { method: "POST", body: { orgName: "Meridian Cloud", email: `sam-${n}@meridian.example`, displayName: "Sam Okafor", password: PW } });
const tA = acme.token, tB = cloudco.token;
const orgA = acme.organization.id, orgB = cloudco.organization.id;

const connA = await call("/v1/agent-connections", { method: "POST", token: tA, body: { organizationId: orgA, name: "Migration Planner", adapterType: "SCRIPTED" } });
const connB = await call("/v1/agent-connections", { method: "POST", token: tB, body: { organizationId: orgB, name: "Infrastructure Agent", adapterType: "SCRIPTED" } });

const room = await call("/v1/rooms", { method: "POST", token: tA, body: { organizationId: orgA, name: "Migrate Project Phoenix to Azure" } });
const roomId = room.room.id;

await call(`/v1/rooms/${roomId}/contract`, { method: "PUT", token: tA, body: { contract: {
  version: "1.0",
  objective: "Produce a complete Azure migration plan for the Phoenix web application",
  participants: [{ organization: "Northwind Freight", role: "customer" }, { organization: "Meridian Cloud", role: "provider" }],
  permittedDataClasses: ["architecture", "resource_inventory", "infrastructure_metadata", "performance_metric", "network_requirements"],
  forbiddenDataClasses: ["credential", "private_key", "customer_data", "pii"],
  permittedActions: ["read_inventory", "generate_migration_plan"],
  approvalRequiredActions: ["create_resource", "change_dns", "spend_money"],
  completionCriteria: [
    { id: "inventory", description: "Infrastructure inventory completed", evidenceRequired: true, requiredEvidenceTypes: [] },
    { id: "plan", description: "Azure migration plan delivered", evidenceRequired: true, requiredEvidenceTypes: [] },
  ],
} } });

const inv = await call(`/v1/rooms/${roomId}/invites`, { method: "POST", token: tA, body: {} });
await call(`/v1/invites/${inv.token}/redeem`, { method: "POST", token: tB, body: { organizationId: orgB } });

const POLICY = {
  allowedEventTypes: ["message","clarification_request","clarification_response","data_request","data_response","action_proposal","action_result","evidence_submission","completion_proposal"],
  dataClassRules: { architecture: "ALLOW", resource_inventory: "ALLOW", infrastructure_metadata: "ALLOW", performance_metric: "ALLOW", network_requirements: "ALLOW", source_code: "REQUIRE_APPROVAL", pii: "DENY", customer_data: "DENY" },
  maxAutoSensitivity: "CONFIDENTIAL",
  autonomousActions: ["read_inventory", "generate_migration_plan"],
  approvalRequiredActions: [],
};
for (const [t, c] of [[tA, connA.id], [tB, connB.id]] as any) {
  await call(`/v1/rooms/${roomId}/policy`, { method: "PUT", token: t, body: { policy: POLICY } });
  await call(`/v1/rooms/${roomId}/agent`, { method: "POST", token: t, body: { agentConnectionId: c } });
  await call(`/v1/rooms/${roomId}/contract/approve`, { method: "POST", token: t, body: { version: 1 } });
}
await call(`/v1/rooms/${roomId}/start`, { method: "POST", token: tA });
await new Promise((r) => setTimeout(r, 8000));

const detail = await call(`/v1/rooms/${roomId}`, { token: tB });
const partB = detail.participants.find((p: any) => p.organizationId === orgB).id;

// A credential disclosure attempt — blocked, and visible in the timeline.
await call(`/v1/rooms/${roomId}/participants/${partB}/events`, { method: "POST", token: tB, body: { candidate: { body: { type: "message", text: "Prod DB connection: postgres://admin:S3cretPass!@db.internal:5432/phoenix" } } } });
// The safe alternative the agent sends instead.
await call(`/v1/rooms/${roomId}/participants/${partB}/events`, { method: "POST", token: tB, body: { candidate: { body: { type: "message", text: "Connection details withheld by policy. Non-secret metadata: PostgreSQL 16.3, eu-west-1, private subnet, 840 GB." }, declaredClassification: { sensitivity: "CONFIDENTIAL", categories: ["infrastructure_metadata"] } } } });
// A production action that must wait for a human.
await call(`/v1/rooms/${roomId}/participants/${partB}/events`, { method: "POST", token: tB, body: { candidate: { body: { type: "action_proposal", action: "change_dns", parameters: { record: "api.phoenix.example.com", from: "52.1.2.3", to: "20.4.5.6" }, reason: "Production cutover to Azure" } } } });

console.log(JSON.stringify({
  roomId,
  acmeEmail: `dana-${n}@northwind.example`,
  cloudcoEmail: `sam-${n}@meridian.example`,
  password: PW,
  tokenA: tA, tokenB: tB,
}, null, 2));
