import { describe, expect, it } from "vitest";
import { decideApproval, parametersHash, submitCandidateEvent } from "../../src/index.js";
import { setupActiveRoom } from "../helpers.js";

async function proposeDnsChange(world: Awaited<ReturnType<typeof setupActiveRoom>>) {
  const r = await submitCandidateEvent(world.ctx, world.orgB.participantId, {
    body: {
      type: "action_proposal",
      action: "change_dns",
      parameters: { record: "api.example.com", to: "20.4.5.6" },
      reason: "cutover",
    },
  });
  if (r.status !== "requires_approval") throw new Error(`expected approval, got ${r.status}`);
  return r.approvalId;
}

describe("human approvals (spec §30, invariant 4)", () => {
  it("approval-required actions never execute before approval (approval bypass)", async () => {
    const world = await setupActiveRoom();
    await proposeDnsChange(world);
    // The action_proposal must NOT be in the routed event stream yet.
    const events = await world.ctx.store.listRoomEvents(world.roomId);
    expect(events.some((e) => e.type === "action_proposal")).toBe(false);
    expect(events.some((e) => e.type === "approval_request")).toBe(true);
  });

  it("only humans of the acting organization can approve", async () => {
    const world = await setupActiveRoom();
    const approvalId = await proposeDnsChange(world);
    await expect(
      decideApproval(world.ctx, world.orgA.userId, approvalId, "approve"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("parameter swapping after approval request invalidates the approval", async () => {
    const world = await setupActiveRoom();
    const approvalId = await proposeDnsChange(world);
    // Attacker mutates the held candidate body in storage.
    const approval = (await world.ctx.store.getApproval(approvalId))!;
    await world.ctx.store.updateApproval({
      ...approval,
      candidateBody: {
        ...(approval.candidateBody as object),
        parameters: { record: "api.example.com", to: "6.6.6.6" },
      },
    });
    await expect(
      decideApproval(world.ctx, world.orgB.userId, approvalId, "approve"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await world.ctx.store.getApproval(approvalId))?.status).toBe("INVALIDATED");
    // And nothing was released.
    const events = await world.ctx.store.listRoomEvents(world.roomId);
    expect(events.some((e) => e.type === "action_proposal")).toBe(false);
  });

  it("an approval cannot be consumed twice (replay)", async () => {
    const world = await setupActiveRoom();
    const approvalId = await proposeDnsChange(world);
    const first = await decideApproval(world.ctx, world.orgB.userId, approvalId, "approve");
    expect(first.status).toBe("APPROVED");
    await expect(
      decideApproval(world.ctx, world.orgB.userId, approvalId, "approve"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // Exactly one released action event.
    const events = await world.ctx.store.listRoomEvents(world.roomId);
    expect(events.filter((e) => e.type === "action_proposal")).toHaveLength(1);
  });

  it("expired approvals cannot be approved", async () => {
    const world = await setupActiveRoom();
    const approvalId = await proposeDnsChange(world);
    const approval = (await world.ctx.store.getApproval(approvalId))!;
    await world.ctx.store.updateApproval({
      ...approval,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await expect(
      decideApproval(world.ctx, world.orgB.userId, approvalId, "approve"),
    ).rejects.toMatchObject({ code: "STATE" });
  });

  it("rejection emits action_rejected and releases nothing", async () => {
    const world = await setupActiveRoom();
    const approvalId = await proposeDnsChange(world);
    const r = await decideApproval(world.ctx, world.orgB.userId, approvalId, "reject");
    expect(r.status).toBe("REJECTED");
    const events = await world.ctx.store.listRoomEvents(world.roomId);
    expect(events.some((e) => e.type === "action_rejected")).toBe(true);
    expect(events.some((e) => e.type === "action_proposal")).toBe(false);
  });

  it("even a human approval cannot release secret material (hard floor)", async () => {
    const world = await setupActiveRoom();
    const approvalId = await proposeDnsChange(world);
    const approval = (await world.ctx.store.getApproval(approvalId))!;
    // Attacker swaps body to include a secret AND fixes up the hash to match.
    const evil = {
      ...(approval.candidateBody as Record<string, unknown>),
      parameters: { note: "password=hunter2secret" },
    };
    await world.ctx.store.updateApproval({
      ...approval,
      candidateBody: evil,
      parametersHash: parametersHash(evil),
    });
    await expect(
      decideApproval(world.ctx, world.orgB.userId, approvalId, "approve"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
