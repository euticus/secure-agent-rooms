import { describe, expect, it } from "vitest";
import {
  createCtx,
  createInvite,
  createRoom,
  previewInvite,
  redeemInvite,
  registerOrganization,
} from "../../src/index.js";

async function setupInviteWorld() {
  const ctx = createCtx();
  const a = await registerOrganization(ctx, { orgName: "A", email: "a@a.example", displayName: "A" });
  const b = await registerOrganization(ctx, { orgName: "B", email: "b@b.example", displayName: "B" });
  const { room } = await createRoom(ctx, a.user.id, { organizationId: a.organization.id, name: "r" });
  return { ctx, a, b, room };
}

describe("secure invitations (spec §12, T4, invariant 8)", () => {
  it("stores only the token hash, never the raw token", async () => {
    const { ctx, a, room } = await setupInviteWorld();
    const { invite, token } = await createInvite(ctx, a.user.id, room.id, {});
    expect(invite.tokenHash).not.toContain(token);
    expect(invite.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("redeemed invites cannot be replayed", async () => {
    const { ctx, a, b, room } = await setupInviteWorld();
    const { token } = await createInvite(ctx, a.user.id, room.id, {});
    await redeemInvite(ctx, b.user.id, token, b.organization.id);
    const c = await registerOrganization(ctx, { orgName: "C", email: "c@c.example", displayName: "C" });
    await expect(redeemInvite(ctx, c.user.id, token, c.organization.id)).rejects.toMatchObject({
      code: "STATE",
    });
  });

  it("expired invites cannot be redeemed", async () => {
    const { ctx, a, b, room } = await setupInviteWorld();
    const { token } = await createInvite(ctx, a.user.id, room.id, { expiresInHours: -1 });
    await expect(redeemInvite(ctx, b.user.id, token, b.organization.id)).rejects.toMatchObject({
      code: "STATE",
    });
  });

  it("email-bound invites reject other users", async () => {
    const { ctx, a, b, room } = await setupInviteWorld();
    const { token } = await createInvite(ctx, a.user.id, room.id, {
      targetEmail: "someone-else@b.example",
    });
    await expect(redeemInvite(ctx, b.user.id, token, b.organization.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("an invite token alone never yields room content (invariant 8)", async () => {
    const { ctx, a, b, room } = await setupInviteWorld();
    const { token } = await createInvite(ctx, a.user.id, room.id, {});
    const preview = await previewInvite(ctx, b.user.id, token);
    // The preview is an authorization summary; it must not carry events/participants.
    expect(Object.keys(preview)).toEqual(
      expect.arrayContaining(["roomName", "invitingOrganization", "contractSummary"]),
    );
    expect(JSON.stringify(preview)).not.toContain("events");
  });

  it("the inviting organization cannot redeem its own invite", async () => {
    const { ctx, a, room } = await setupInviteWorld();
    const { token } = await createInvite(ctx, a.user.id, room.id, {});
    await expect(redeemInvite(ctx, a.user.id, token, a.organization.id)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});
