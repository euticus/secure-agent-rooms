import { beforeEach, describe, expect, it } from "vitest";
import { MemoryEmailSender } from "@booth/email";
import {
  NotificationDispatcher,
  RoomRuntimeManager,
  acceptInvitation,
  createCtx,
  launchRoom,
  previewInvite,
  registerOrganization,
  roomSetupStatus,
  setEmailSender,
  startRoom,
  type Ctx,
} from "../src/index.js";

let mail: MemoryEmailSender;

beforeEach(() => {
  mail = new MemoryEmailSender();
  setEmailSender(mail, { enabled: true, from: "test@booth.example", appUrl: "https://booth.example" });
});

async function twoCompanies(): Promise<{
  ctx: Ctx;
  acme: { userId: string; orgId: string };
  cloudco: { userId: string; orgId: string; email: string };
}> {
  const ctx = createCtx();
  const n = Math.random().toString(36).slice(2, 8);
  const a = await registerOrganization(ctx, {
    orgName: "Acme", email: `alice-${n}@acme.example`, displayName: "Alice",
  });
  const b = await registerOrganization(ctx, {
    orgName: "CloudCo", email: `bob-${n}@cloudco.example`, displayName: "Bob",
  });
  return {
    ctx,
    acme: { userId: a.user.id, orgId: a.organization.id },
    cloudco: { userId: b.user.id, orgId: b.organization.id, email: b.user.email },
  };
}

describe("signup provisions a working organization", () => {
  it("gives every new organization a ready-to-use sandbox agent", async () => {
    const { ctx, acme } = await twoCompanies();
    const conns = await ctx.store.listAgentConnections(acme.orgId);
    expect(conns).toHaveLength(1);
    expect(conns[0]!.adapterType).toBe("SCRIPTED");
    expect(conns[0]!.status).toBe("ACTIVE");
    // It needs no credential, so it cannot be misconfigured into failing.
    expect(conns[0]!.credentialReference).toBeNull();
  });

  it("welcomes the new owner by email", async () => {
    const { ctx } = await twoCompanies();
    await new NotificationDispatcher(ctx, { sender: mail }).tick();
    expect(mail.sent.filter((m) => m.subject.includes("is set up")).length).toBeGreaterThan(0);
  });
});

describe("launchRoom collapses setup into one action", () => {
  it("creates, configures, approves and invites in a single call", async () => {
    const { ctx, acme, cloudco } = await twoCompanies();
    const result = await launchRoom(ctx, acme.userId, {
      organizationId: acme.orgId,
      templateId: "cloud_migration",
      name: "Migrate Phoenix to Azure",
      counterpartEmail: cloudco.email,
      personalNote: "Looking forward to it.",
    });

    expect(result.invitationEmailed).toBe(true);
    expect(result.inviteToken).toBeTruthy();

    // The inviting side is fully set up already.
    const status = await roomSetupStatus(ctx, acme.userId, result.room.id);
    const mine = status.steps.filter((s) => s.yours);
    expect(mine.every((s) => s.done)).toBe(true);
    expect(status.canStart).toBe(false); // still waiting on the other company
  });

  it("emails an invitation the counterpart can act on", async () => {
    const { ctx, acme, cloudco } = await twoCompanies();
    const result = await launchRoom(ctx, acme.userId, {
      organizationId: acme.orgId,
      templateId: "vendor_security_review",
      name: "Q3 vendor review",
      counterpartEmail: cloudco.email,
    });
    await new NotificationDispatcher(ctx, { sender: mail }).tick();

    const invite = mail.sent.find((m) => m.subject.includes("invited you to collaborate"));
    expect(invite).toBeTruthy();
    expect(invite!.to).toBe(cloudco.email);
    expect(invite!.text).toContain(result.inviteToken);
    // The email says what it is about, but discloses no room content.
    expect(invite!.text).toContain("Q3 vendor review");
  });

  it("rejects an unknown template", async () => {
    const { ctx, acme } = await twoCompanies();
    await expect(
      launchRoom(ctx, acme.userId, { organizationId: acme.orgId, templateId: "nope", name: "x" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("acceptInvitation completes the other side in one action", () => {
  it("takes the room from invited to READY and then it can run", async () => {
    const { ctx, acme, cloudco } = await twoCompanies();
    const launched = await launchRoom(ctx, acme.userId, {
      organizationId: acme.orgId,
      templateId: "cloud_migration",
      name: "Migrate Phoenix to Azure",
      counterpartEmail: cloudco.email,
    });

    // The invitee still sees the full terms before accepting.
    const preview = await previewInvite(ctx, cloudco.userId, launched.inviteToken);
    expect(preview.contractSummary?.forbiddenDataClasses).toContain("credential");

    const accepted = await acceptInvitation(ctx, cloudco.userId, {
      token: launched.inviteToken,
      organizationId: cloudco.orgId,
    });
    expect(accepted.ready).toBe(true);
    expect(accepted.state).toBe("READY");

    // And the room genuinely runs from there.
    await startRoom(ctx, acme.userId, launched.room.id);
    await new RoomRuntimeManager(ctx, { turnDelayMs: 0, maxTurnsPerPickup: 30 }).runOnce(launched.room.id);
    const events = await ctx.store.listRoomEvents(launched.room.id);
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "data_request")).toBe(true);
  });

  it("derives the invitee's policy from the agreed contract, denying what the contract forbids", async () => {
    const { ctx, acme, cloudco } = await twoCompanies();
    const launched = await launchRoom(ctx, acme.userId, {
      organizationId: acme.orgId,
      templateId: "cloud_migration",
      name: "Migration",
      counterpartEmail: cloudco.email,
    });
    await acceptInvitation(ctx, cloudco.userId, {
      token: launched.inviteToken,
      organizationId: cloudco.orgId,
    });

    const participants = await ctx.store.listParticipants(launched.room.id);
    const theirs = participants.find((p) => p.organizationId === cloudco.orgId);
    expect(theirs?.policy?.dataClassRules.architecture).toBe("ALLOW");
    expect(theirs?.policy?.dataClassRules.customer_data).toBe("DENY");
    expect(theirs?.policy?.dataClassRules.pii).toBe("DENY");
  });

  it("a used invitation cannot be accepted twice", async () => {
    const { ctx, acme, cloudco } = await twoCompanies();
    const launched = await launchRoom(ctx, acme.userId, {
      organizationId: acme.orgId, templateId: "blank", name: "Once only",
      counterpartEmail: cloudco.email,
    });
    await acceptInvitation(ctx, cloudco.userId, {
      token: launched.inviteToken, organizationId: cloudco.orgId,
    });
    const third = await registerOrganization(ctx, {
      orgName: "Third", email: `t-${Math.random().toString(36).slice(2, 8)}@t.example`, displayName: "T",
    });
    await expect(
      acceptInvitation(ctx, third.user.id, {
        token: launched.inviteToken, organizationId: third.organization.id,
      }),
    ).rejects.toMatchObject({ code: "STATE" });
  });
});

describe("setup status tells the user what is left", () => {
  it("names the next action at each stage", async () => {
    const { ctx, acme, cloudco } = await twoCompanies();
    const launched = await launchRoom(ctx, acme.userId, {
      organizationId: acme.orgId, templateId: "cloud_migration", name: "Phoenix",
      counterpartEmail: cloudco.email,
    });

    let status = await roomSetupStatus(ctx, acme.userId, launched.room.id);
    expect(status.nextAction).toContain("Other company joined");

    await acceptInvitation(ctx, cloudco.userId, {
      token: launched.inviteToken, organizationId: cloudco.orgId,
    });
    status = await roomSetupStatus(ctx, acme.userId, launched.room.id);
    expect(status.canStart).toBe(true);
    expect(status.nextAction).toBe("Start the room");
  });
});
