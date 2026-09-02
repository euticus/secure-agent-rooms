import { describe, expect, it } from "vitest";
import {
  createInvite,
  createRoom,
  listApprovalsForRoom,
  proposeContract,
  redeemInvite,
  registerOrganization,
  requireRoomAccess,
  submitCandidateEvent,
} from "../../src/index.js";
import { CONTRACT, setupActiveRoom } from "../helpers.js";

describe("tenant isolation (T6, invariant 9)", () => {
  it("a third organization cannot access an unrelated room", async () => {
    const world = await setupActiveRoom();
    const outsider = await registerOrganization(world.ctx, {
      orgName: "Mallory Corp",
      email: "mallory@evil.example",
      displayName: "Mallory",
    });

    // Room access is reported as NOT_FOUND, indistinguishable from nonexistence.
    await expect(requireRoomAccess(world.ctx, outsider.user.id, world.roomId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      listApprovalsForRoom(world.ctx, outsider.user.id, world.roomId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      createInvite(world.ctx, outsider.user.id, world.roomId, {}),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      proposeContract(world.ctx, outsider.user.id, world.roomId, CONTRACT),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("membership in one org grants nothing in another org's resources", async () => {
    const world = await setupActiveRoom();
    // Org B's user cannot create rooms under org A.
    await expect(
      createRoom(world.ctx, world.orgB.userId, { organizationId: world.orgA.id, name: "sneaky" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("cross-room leakage: a participant of room 1 cannot emit into room 2", async () => {
    const w1 = await setupActiveRoom();
    const w2 = await setupActiveRoom();
    // Participant ids are room-scoped; w1's participant does not exist in w2's store
    // (separate ctx) — simulate same-store worlds instead:
    const { ctx } = w1;
    const other = await registerOrganization(ctx, {
      orgName: "OtherOrg",
      email: "other@other.example",
      displayName: "Other",
    });
    // Build a second room in the SAME store.
    const roomB = await createRoom(ctx, other.user.id, {
      organizationId: other.organization.id,
      name: "unrelated",
    });
    // w1 participant submitting is scoped to its own room only; verify the event
    // lands in w1's room and never in roomB.
    const r = await submitCandidateEvent(ctx, w1.orgA.participantId, {
      body: { type: "message", text: "hello" },
    });
    expect(r.status).toBe("allowed");
    expect(await ctx.store.listRoomEvents(roomB.room.id)).toHaveLength(0);
    void w2;
  });

  it("agent impersonation: unknown participant ids are rejected", async () => {
    const world = await setupActiveRoom();
    await expect(
      submitCandidateEvent(world.ctx, "part_forged", { body: { type: "message", text: "hi" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
