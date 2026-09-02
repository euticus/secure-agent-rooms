import { beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

let app: FastifyInstance;

interface Actor {
  token: string;
  orgId: string;
  userId: string;
}

async function register(orgName: string, email: string): Promise<Actor> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { orgName, email, displayName: orgName },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  return { token: body.token, orgId: body.organization.id, userId: body.user.id };
}

function auth(actor: Actor) {
  return { authorization: `Bearer ${actor.token}` };
}

const CONTRACT = {
  version: "1.0",
  objective: "Migrate app",
  participants: [
    { organization: "Acme", role: "customer" },
    { organization: "CloudCo", role: "provider" },
  ],
  permittedDataClasses: ["architecture", "infrastructure_metadata"],
  forbiddenDataClasses: ["credential", "pii"],
  permittedActions: ["read_inventory"],
  approvalRequiredActions: ["change_dns"],
  completionCriteria: [{ id: "c1", description: "done", evidenceRequired: true, requiredEvidenceTypes: [] }],
};

const POLICY = {
  allowedEventTypes: ["message", "data_request", "data_response", "action_proposal", "evidence_submission", "completion_proposal"],
  dataClassRules: { architecture: "ALLOW", infrastructure_metadata: "ALLOW" },
  maxAutoSensitivity: "CONFIDENTIAL",
  autonomousActions: ["read_inventory"],
  approvalRequiredActions: [],
};

describe("API integration", () => {
  beforeAll(async () => {
    app = await buildApp();
  });

  it("requires authentication", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/rooms?organizationId=x" });
    expect(res.statusCode).toBe(401);
  });

  it("drives a room from creation to ACTIVE over HTTP and enforces tenancy", async () => {
    const alice = await register("Acme", "alice@acme.example");
    const bob = await register("CloudCo", "bob@cloudco.example");
    const mallory = await register("Evil", "mallory@evil.example");

    // Create room + connections
    const roomRes = await app.inject({
      method: "POST",
      url: "/v1/rooms",
      headers: auth(alice),
      payload: { organizationId: alice.orgId, name: "Phoenix" },
    });
    expect(roomRes.statusCode).toBe(200);
    const roomId = roomRes.json().room.id;

    // Tenant isolation over HTTP: outsider sees 404.
    const spy = await app.inject({ method: "GET", url: `/v1/rooms/${roomId}`, headers: auth(mallory) });
    expect(spy.statusCode).toBe(404);

    const connA = await app.inject({
      method: "POST",
      url: "/v1/agent-connections",
      headers: auth(alice),
      payload: { organizationId: alice.orgId, name: "Planner", adapterType: "SCRIPTED" },
    });
    const connB = await app.inject({
      method: "POST",
      url: "/v1/agent-connections",
      headers: auth(bob),
      payload: { organizationId: bob.orgId, name: "Infra", adapterType: "SCRIPTED" },
    });
    // Bob cannot create a connection under Alice's org.
    const forged = await app.inject({
      method: "POST",
      url: "/v1/agent-connections",
      headers: auth(bob),
      payload: { organizationId: alice.orgId, name: "X", adapterType: "SCRIPTED" },
    });
    expect(forged.statusCode).toBe(403);

    // Invite + redeem
    const invite = await app.inject({
      method: "POST",
      url: `/v1/rooms/${roomId}/invites`,
      headers: auth(alice),
      payload: {},
    });
    const token = invite.json().token;
    expect(token).toBeTruthy();

    const redeem = await app.inject({
      method: "POST",
      url: `/v1/invites/${token}/redeem`,
      headers: auth(bob),
      payload: { organizationId: bob.orgId },
    });
    expect(redeem.statusCode).toBe(200);

    // Replay fails
    const replay = await app.inject({
      method: "POST",
      url: `/v1/invites/${token}/redeem`,
      headers: auth(mallory),
      payload: { organizationId: mallory.orgId },
    });
    expect(replay.statusCode).toBe(409);

    // Contract, policies, agents, approvals, start
    await app.inject({
      method: "PUT",
      url: `/v1/rooms/${roomId}/contract`,
      headers: auth(alice),
      payload: { contract: CONTRACT },
    });
    for (const [actor, conn] of [
      [alice, connA.json().id],
      [bob, connB.json().id],
    ] as const) {
      await app.inject({
        method: "PUT",
        url: `/v1/rooms/${roomId}/policy`,
        headers: auth(actor),
        payload: { policy: POLICY },
      });
      await app.inject({
        method: "POST",
        url: `/v1/rooms/${roomId}/agent`,
        headers: auth(actor),
        payload: { agentConnectionId: conn },
      });
      await app.inject({
        method: "POST",
        url: `/v1/rooms/${roomId}/contract/approve`,
        headers: auth(actor),
        payload: { version: 1 },
      });
    }
    const start = await app.inject({ method: "POST", url: `/v1/rooms/${roomId}/start`, headers: auth(alice) });
    expect(start.json().state).toBe("ACTIVE");

    // Submit an event through the pipeline over HTTP.
    const detail = await app.inject({ method: "GET", url: `/v1/rooms/${roomId}`, headers: auth(alice) });
    const partA = detail.json().participants.find((p: { organizationId: string }) => p.organizationId === alice.orgId);
    const partB = detail.json().participants.find((p: { organizationId: string }) => p.organizationId === bob.orgId);

    const msg = await app.inject({
      method: "POST",
      url: `/v1/rooms/${roomId}/participants/${partA.id}/events`,
      headers: auth(alice),
      payload: { candidate: { body: { type: "message", text: "hello" } } },
    });
    expect(msg.json().status).toBe("allowed");

    // Alice cannot submit as Bob's participant.
    const imp = await app.inject({
      method: "POST",
      url: `/v1/rooms/${roomId}/participants/${partB.id}/events`,
      headers: auth(alice),
      payload: { candidate: { body: { type: "message", text: "spoof" } } },
    });
    expect(imp.statusCode).toBe(404);

    // Secret exfiltration over HTTP is denied.
    const leak = await app.inject({
      method: "POST",
      url: `/v1/rooms/${roomId}/participants/${partB.id}/events`,
      headers: auth(bob),
      payload: { candidate: { body: { type: "message", text: "AKIAIOSFODNN7EXAMPLE" } } },
    });
    expect(leak.json().status).toBe("denied");

    // Events endpoint returns the timeline; audit endpoint verifies the chain.
    const events = await app.inject({ method: "GET", url: `/v1/rooms/${roomId}/events`, headers: auth(bob) });
    expect(events.json().length).toBeGreaterThan(0);
    const audit = await app.inject({ method: "GET", url: `/v1/rooms/${roomId}/audit`, headers: auth(alice) });
    expect(audit.json().integrity.chainValid).toBe(true);
  });

  it("honors Idempotency-Key on state-changing requests", async () => {
    const carol = await register("Carol Org", "carol@carol.example");
    const payload = { organizationId: carol.orgId, name: "Idem room" };
    const h = { ...auth(carol), "idempotency-key": "key-123" };
    const first = await app.inject({ method: "POST", url: "/v1/rooms", headers: h, payload });
    const second = await app.inject({ method: "POST", url: "/v1/rooms", headers: h, payload });
    expect(second.headers["idempotency-replayed"]).toBe("true");
    expect(second.json().room.id).toBe(first.json().room.id);
  });


  it("rejects unsupported and under-specified agent connections", async () => {
    const dave = await register("Dave Org", "dave@dave.example");
    const unsupported = await app.inject({
      method: "POST", url: "/v1/agent-connections", headers: auth(dave),
      payload: { organizationId: dave.orgId, name: "x", adapterType: "MCP_BRIDGE" },
    });
    expect(unsupported.statusCode).toBe(400);
    const noCred = await app.inject({
      method: "POST", url: "/v1/agent-connections", headers: auth(dave),
      payload: { organizationId: dave.orgId, name: "x", adapterType: "HOSTED_ANTHROPIC" },
    });
    expect(noCred.statusCode).toBe(400);
    const a2a = await app.inject({
      method: "POST", url: "/v1/agent-connections", headers: auth(dave),
      payload: { organizationId: dave.orgId, name: "x", adapterType: "A2A_NATIVE", endpoint: "https://a.example" },
    });
    expect(a2a.statusCode).toBe(400); // missing pinned card hash
  });

  it("accepts bodyless POSTs that set a JSON content-type", async () => {
    const eve = await register("Eve Org", "eve@eve.example");
    const res = await app.inject({
      method: "POST", url: "/v1/auth/logout",
      headers: { ...auth(eve), "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("logout revokes the bearer token", async () => {
    const frank = await register("Frank Org", "frank@frank.example");
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: auth(frank) })).statusCode).toBe(200);
    await app.inject({ method: "POST", url: "/v1/auth/logout", headers: auth(frank) });
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: auth(frank) })).statusCode).toBe(401);
  });

  it("does not cache auth responses under Idempotency-Key", async () => {
    const h = { "idempotency-key": "shared-key", "content-type": "application/json" };
    const first = await app.inject({
      method: "POST", url: "/v1/auth/register", headers: h,
      payload: { orgName: "Idem A", email: "idem-a@x.example", displayName: "A" },
    });
    const second = await app.inject({
      method: "POST", url: "/v1/auth/register", headers: h,
      payload: { orgName: "Idem B", email: "idem-b@x.example", displayName: "B" },
    });
    expect(second.headers["idempotency-replayed"]).toBeUndefined();
    expect(second.json().token).not.toBe(first.json().token);
  });

  it("rejects self-serve registration for an existing email", async () => {
    await register("Dup Org", "dup@dup.example");
    const again = await app.inject({
      method: "POST", url: "/v1/auth/register",
      payload: { orgName: "Dup Org 2", email: "dup@dup.example", displayName: "D" },
    });
    expect(again.statusCode).toBe(409);
  });

  it("supports password registration and login, and rejects bad credentials", async () => {
    const payload = {
      orgName: "Password Org", email: "pw@pw.example", displayName: "P",
      password: "a-sufficiently-long-password",
    };
    const reg = await app.inject({ method: "POST", url: "/v1/auth/register", payload });
    expect(reg.statusCode).toBe(200);
    // The password hash is never returned to the client.
    expect(JSON.stringify(reg.json())).not.toContain("scrypt$");

    const ok = await app.inject({
      method: "POST", url: "/v1/auth/login",
      payload: { email: payload.email, password: payload.password },
    });
    expect(ok.statusCode).toBe(200);
    const me = await app.inject({
      method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${ok.json().token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(JSON.stringify(me.json())).not.toContain("scrypt$");

    const bad = await app.inject({
      method: "POST", url: "/v1/auth/login",
      payload: { email: payload.email, password: "wrong-password-value" },
    });
    expect(bad.statusCode).toBe(401);
    const unknown = await app.inject({
      method: "POST", url: "/v1/auth/login",
      payload: { email: "nobody@nowhere.example", password: "wrong-password-value" },
    });
    // Identical response for unknown accounts — no enumeration.
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json()).toEqual(bad.json());
  });

  it("supports team membership: add, change role, remove", async () => {
    const owner = await register("Team Org", "owner@team.example");
    const add = await app.inject({
      method: "POST", url: `/v1/organizations/${owner.orgId}/members`, headers: auth(owner),
      payload: { email: "colleague@team.example", displayName: "Colleague", role: "admin", initialPassword: "a-sufficiently-long-password" },
    });
    expect(add.statusCode).toBe(200);
    const membershipId = add.json().membershipId;

    // The colleague can now sign in and see the same organization.
    const login = await app.inject({
      method: "POST", url: "/v1/auth/login",
      payload: { email: "colleague@team.example", password: "a-sufficiently-long-password" },
    });
    expect(login.statusCode).toBe(200);
    const me = await app.inject({
      method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${login.json().token}` },
    });
    expect(me.json().organizations[0].id).toBe(owner.orgId);

    const list = await app.inject({
      method: "GET", url: `/v1/organizations/${owner.orgId}/members`, headers: auth(owner),
    });
    expect(list.json()).toHaveLength(2);

    const patch = await app.inject({
      method: "PATCH", url: `/v1/organizations/${owner.orgId}/members/${membershipId}`,
      headers: auth(owner), payload: { role: "auditor" },
    });
    expect(patch.statusCode).toBe(200);

    const del = await app.inject({
      method: "DELETE", url: `/v1/organizations/${owner.orgId}/members/${membershipId}`, headers: auth(owner),
    });
    expect(del.statusCode).toBe(200);
  });

  it("refuses to remove the last owner, and blocks outsiders from the member list", async () => {
    const owner = await register("Solo Org", "solo@solo.example");
    const outsider = await register("Other Org", "other@other.example");
    const list = await app.inject({
      method: "GET", url: `/v1/organizations/${owner.orgId}/members`, headers: auth(outsider),
    });
    expect(list.statusCode).toBe(403);

    const members = await app.inject({
      method: "GET", url: `/v1/organizations/${owner.orgId}/members`, headers: auth(owner),
    });
    const ownerMembership = members.json()[0].membershipId;
    const del = await app.inject({
      method: "DELETE", url: `/v1/organizations/${owner.orgId}/members/${ownerMembership}`, headers: auth(owner),
    });
    expect(del.statusCode).toBe(409);
  });

  it("rejects agent connections that name a raw environment variable", async () => {
    const org = await register("Cred Org", "cred@cred.example");
    const evil = await app.inject({
      method: "POST", url: "/v1/agent-connections", headers: auth(org),
      payload: {
        organizationId: org.orgId, name: "exfil", adapterType: "HOSTED_OPENAI",
        credentialReference: "env:BOOTH_AUDIT_KEY",
        config: { baseUrl: "https://attacker.example/v1" },
      },
    });
    // credentialReference is not an accepted field; a slug is required instead.
    expect(evil.statusCode).toBe(400);

    const ok = await app.inject({
      method: "POST", url: "/v1/agent-connections", headers: auth(org),
      payload: { organizationId: org.orgId, name: "openai", adapterType: "HOSTED_OPENAI", credentialSlug: "openai" },
    });
    expect(ok.statusCode).toBe(200);
    // The server tells the operator which variable to set, scoped to their org.
    expect(ok.json().credentialEnvVar).toContain("BOOTH_CRED_");
    expect(JSON.stringify(ok.json())).not.toContain("credentialReference");
  });

  it("exposes pending approvals for an organization", async () => {
    const org = await register("Pending Org", "pending@pending.example");
    const res = await app.inject({
      method: "GET", url: `/v1/approvals/pending?organizationId=${org.orgId}`, headers: auth(org),
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("readiness probe reports storage health", async () => {
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("launches a fully configured room in one call", async () => {
    const owner = await register("Launch Org", "launch@launch.example");
    const templates = await app.inject({ method: "GET", url: "/v1/templates", headers: auth(owner) });
    expect(templates.json().length).toBeGreaterThan(1);

    const res = await app.inject({
      method: "POST", url: "/v1/rooms/launch", headers: auth(owner),
      payload: {
        organizationId: owner.orgId,
        templateId: "cloud_migration",
        name: "Launch test",
        counterpartEmail: "counterpart@other.example",
      },
    });
    expect(res.statusCode).toBe(200);
    const launched = res.json();
    expect(launched.inviteToken).toBeTruthy();

    // The launching side is already fully set up.
    const setup = await app.inject({
      method: "GET", url: `/v1/rooms/${launched.room.id}/setup`, headers: auth(owner),
    });
    const mine = setup.json().steps.filter((s: { yours: boolean }) => s.yours);
    expect(mine.every((s: { done: boolean }) => s.done)).toBe(true);
  });

  it("lets the invited side accept and reach READY in one call", async () => {
    const inviter = await register("Inviter Org", "inviter@a.example");
    const invitee = await register("Invitee Org", "invitee@b.example");
    const launched = (await app.inject({
      method: "POST", url: "/v1/rooms/launch", headers: auth(inviter),
      payload: { organizationId: inviter.orgId, templateId: "vendor_security_review", name: "Review" },
    })).json();

    const accepted = await app.inject({
      method: "POST", url: `/v1/invites/${launched.inviteToken}/accept`, headers: auth(invitee),
      payload: { organizationId: invitee.orgId },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().ready).toBe(true);

    const start = await app.inject({
      method: "POST", url: `/v1/rooms/${launched.room.id}/start`, headers: auth(inviter),
    });
    expect(start.json().state).toBe("ACTIVE");
  });

  it("provisions a sandbox agent for every new organization", async () => {
    const org = await register("Fresh Org", "fresh@fresh.example");
    const conns = await app.inject({
      method: "GET", url: `/v1/agent-connections?organizationId=${org.orgId}`, headers: auth(org),
    });
    expect(conns.json()).toHaveLength(1);
    expect(conns.json()[0].adapterType).toBe("SCRIPTED");
  });

  it("exposes and updates notification settings", async () => {
    const org = await register("Notify Org", "notify@notify.example");
    const get = await app.inject({ method: "GET", url: "/v1/notifications/settings", headers: auth(org) });
    expect(get.json().emailNotifications).toBe(true);
    const put = await app.inject({
      method: "PUT", url: "/v1/notifications/settings", headers: auth(org),
      payload: { emailNotifications: false },
    });
    expect(put.json().emailNotifications).toBe(false);
    const after = await app.inject({ method: "GET", url: "/v1/notifications/settings", headers: auth(org) });
    expect(after.json().emailNotifications).toBe(false);
  });

  it("accepts an invitation token as a signup gate", async () => {
    const inviter = await register("Gate Org", "gate@gate.example");
    const launched = (await app.inject({
      method: "POST", url: "/v1/rooms/launch", headers: auth(inviter),
      payload: { organizationId: inviter.orgId, templateId: "blank", name: "Gated" },
    })).json();

    process.env.BOOTH_SIGNUP_KEY = "closed-beta";
    try {
      const blocked = await app.inject({
        method: "POST", url: "/v1/auth/register",
        payload: { orgName: "No Key", email: "nokey@x.example", displayName: "N", password: "a-sufficiently-long-password" },
      });
      expect(blocked.statusCode).toBe(403);

      const allowed = await app.inject({
        method: "POST", url: "/v1/auth/register",
        payload: {
          orgName: "Invited Co", email: "invited@x.example", displayName: "I",
          password: "a-sufficiently-long-password", inviteToken: launched.inviteToken,
        },
      });
      expect(allowed.statusCode).toBe(200);
    } finally {
      delete process.env.BOOTH_SIGNUP_KEY;
    }
  });

  it("serves generated OpenAPI", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/openapi.json" });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/v1/rooms", "/v1/rooms/{roomId}/invites", "/v1/approvals/{approvalId}/approve"]),
    );
  });
});
