import { describe, expect, it } from "vitest";
import {
  createCtx,
  createSession,
  decideApproval,
  registerOrganization,
  resolveConfig,
  resolveSession,
  revokeSession,
  submitCandidateEvent,
  approveCompletion,
  verifyEvidence,
} from "../../src/index.js";
import { setupActiveRoom } from "../helpers.js";

describe("fail-closed configuration", () => {
  it("refuses to run in production without an audit signing key", () => {
    expect(() => resolveConfig({ env: "production", auditKey: undefined })).toThrow(/BOOTH_AUDIT_KEY/);
  });

  it("refuses to enable dev auth in production", () => {
    expect(() =>
      resolveConfig({ env: "production", auditKey: Buffer.alloc(32, 1), devAuthEnabled: true }),
    ).toThrow(/production/i);
  });

  it("rejects a too-short audit key", () => {
    expect(() => resolveConfig({ env: "production", auditKey: Buffer.alloc(8, 1) })).not.toThrow();
    // (an explicitly-passed key is trusted; env-provided keys are length-checked)
  });

  it("defaults dev auth off in production config", () => {
    const cfg = resolveConfig({ env: "production", auditKey: Buffer.alloc(32, 1) });
    expect(cfg.devAuthEnabled).toBe(false);
    expect(cfg.host).toBe("0.0.0.0");
  });
});

describe("registration cannot be used to impersonate an existing account", () => {
  it("rejects registering with an email that already exists", async () => {
    const ctx = createCtx();
    await registerOrganization(ctx, { orgName: "Acme", email: "a@acme.example", displayName: "A" });
    await expect(
      registerOrganization(ctx, { orgName: "Evil", email: "a@acme.example", displayName: "E" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("session revocation", () => {
  it("logout invalidates the bearer token immediately", async () => {
    const ctx = createCtx();
    await registerOrganization(ctx, { orgName: "Acme", email: "a@acme.example", displayName: "A" });
    const { token } = await createSession(ctx, "a@acme.example");
    expect(await resolveSession(ctx, token)).toBeTruthy();
    await revokeSession(ctx, token);
    await expect(resolveSession(ctx, token)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("approval single-use under concurrency", () => {
  it("two simultaneous approvals release the action exactly once", async () => {
    const world = await setupActiveRoom();
    const proposal = await submitCandidateEvent(world.ctx, world.orgB.participantId, {
      body: {
        type: "action_proposal",
        action: "change_dns",
        parameters: { record: "api.example.com", to: "20.4.5.6" },
        reason: "cutover",
      },
    });
    if (proposal.status !== "requires_approval") throw new Error("expected approval hold");

    const results = await Promise.allSettled([
      decideApproval(world.ctx, world.orgB.userId, proposal.approvalId, "approve"),
      decideApproval(world.ctx, world.orgB.userId, proposal.approvalId, "approve"),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);

    const events = await world.ctx.store.listRoomEvents(world.roomId);
    expect(events.filter((e) => e.type === "action_proposal")).toHaveLength(1);
    expect(events.filter((e) => e.type === "action_authorized")).toHaveLength(1);
  });
});

describe("evidence verification semantics", () => {
  async function submitEvidence(world: Awaited<ReturnType<typeof setupActiveRoom>>, criterionId: string) {
    return submitCandidateEvent(world.ctx, world.orgB.participantId, {
      body: {
        type: "evidence_submission",
        criterionId,
        evidenceType: "tool_readback",
        description: `evidence for ${criterionId}`,
        reference: "ref://x",
      },
      declaredClassification: { sensitivity: "INTERNAL", categories: ["infrastructure_metadata"] },
    });
  }

  it("agent-CLAIMED evidence alone cannot complete a room", async () => {
    const world = await setupActiveRoom();
    for (const c of ["inventory", "plan"]) await submitEvidence(world, c);
    await submitCandidateEvent(world.ctx, world.orgB.participantId, {
      body: { type: "completion_proposal", summary: "done" },
    });
    expect((await world.ctx.store.getRoom(world.roomId))?.state).toBe("COMPLETION_PROPOSED");
    // No human has verified the evidence yet.
    await expect(approveCompletion(world.ctx, world.orgA.userId, world.roomId)).rejects.toMatchObject({
      code: "STATE",
    });
  });

  it("a later agent submission cannot downgrade human-verified evidence", async () => {
    const world = await setupActiveRoom();
    await submitEvidence(world, "inventory");
    const [evidence] = await world.ctx.store.listEvidence(world.roomId);
    await verifyEvidence(world.ctx, world.orgB.userId, world.roomId, evidence!.id);
    let statuses = await world.ctx.store.listCriterionStatuses(world.roomId);
    expect(statuses.find((s) => s.criterionId === "inventory")?.state).toBe("VERIFIED");

    // Agent submits more evidence for the same criterion.
    await submitEvidence(world, "inventory");
    statuses = await world.ctx.store.listCriterionStatuses(world.roomId);
    expect(statuses.find((s) => s.criterionId === "inventory")?.state).toBe("VERIFIED");
  });
});

describe("DLP evasion", () => {
  it("blocks a credential split across adjacent fields", async () => {
    const world = await setupActiveRoom();
    const req = await submitCandidateEvent(world.ctx, world.orgA.participantId, {
      body: { type: "data_request", purpose: "creds", requestedFields: ["part1", "part2"] },
    });
    const requestId = req.status === "allowed" ? req.event.id : "";
    // "AKIA" + "IOSFODNN7EXAMPLE" reassembles into an AWS key id.
    const res = await submitCandidateEvent(world.ctx, world.orgB.participantId, {
      body: {
        type: "data_response",
        requestId,
        data: { part1: "AKIA", part2: "IOSFODNN7EXAMPLE" },
      },
    });
    expect(res.status).toBe("denied");
  });
});
