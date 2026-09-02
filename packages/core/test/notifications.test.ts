import { beforeEach, describe, expect, it } from "vitest";
import { MemoryEmailSender } from "@booth/email";
import {
  NotificationDispatcher,
  decideApproval,
  setEmailNotifications,
  setEmailSender,
  submitCandidateEvent,
} from "../src/index.js";
import { setupActiveRoom } from "./helpers.js";

let mail: MemoryEmailSender;

beforeEach(() => {
  mail = new MemoryEmailSender();
  setEmailSender(mail, { enabled: true, from: "test@booth.example", appUrl: "https://booth.example" });
});

async function proposeDnsChange(world: Awaited<ReturnType<typeof setupActiveRoom>>) {
  const r = await submitCandidateEvent(world.ctx, world.orgB.participantId, {
    body: {
      type: "action_proposal",
      action: "change_dns",
      parameters: { record: "api.example.com", to: "20.4.5.6", secretish: "not-a-secret" },
      reason: "cutover",
    },
  });
  if (r.status !== "requires_approval") throw new Error(`expected approval, got ${r.status}`);
  return r.approvalId;
}

describe("approval notifications", () => {
  it("emails the approving organization when an approval is held", async () => {
    const world = await setupActiveRoom();
    await proposeDnsChange(world);

    const dispatcher = new NotificationDispatcher(world.ctx, { sender: mail });
    await dispatcher.tick();

    const approvalMail = mail.sent.filter((m) => m.subject.includes("Approval needed"));
    expect(approvalMail).toHaveLength(1);
    expect(approvalMail[0]!.subject).toContain("change_dns");
    // It goes to the ACTING organization's people — the ones who can decide.
    const bob = await world.ctx.store.getUser(world.orgB.userId);
    expect(approvalMail[0]!.to).toBe(bob!.email);
  });

  it("never puts the proposed parameters in the email", async () => {
    const world = await setupActiveRoom();
    await proposeDnsChange(world);
    await new NotificationDispatcher(world.ctx, { sender: mail }).tick();

    const body = mail.sent.map((m) => `${m.subject}\n${m.text}\n${m.html ?? ""}`).join("\n");
    expect(body).not.toContain("20.4.5.6");
    expect(body).not.toContain("api.example.com");
    expect(body).not.toContain("not-a-secret");
    // But it does say where to go.
    expect(body).toContain("https://booth.example/rooms/");
  });

  it("sends each notification exactly once, even across repeated dispatches", async () => {
    const world = await setupActiveRoom();
    await proposeDnsChange(world);
    const dispatcher = new NotificationDispatcher(world.ctx, { sender: mail });
    await dispatcher.tick();
    await dispatcher.tick();
    await dispatcher.tick();
    expect(mail.sent.filter((m) => m.subject.includes("Approval needed"))).toHaveLength(1);
  });

  it("suppresses the reminder once the approval has been decided", async () => {
    const world = await setupActiveRoom();
    const approvalId = await proposeDnsChange(world);

    // The reminder is queued for later; decide the approval first.
    await decideApproval(world.ctx, world.orgB.userId, approvalId, "approve");

    // Jump past the reminder delay.
    const realNow = world.ctx.clock.now.bind(world.ctx.clock);
    world.ctx.clock.now = () => new Date(realNow().getTime() + 6 * 3600_000);

    await new NotificationDispatcher(world.ctx, { sender: mail }).tick();
    expect(mail.sent.filter((m) => m.subject.startsWith("Still waiting"))).toHaveLength(0);
  });

  it("sends the reminder while the approval is still pending", async () => {
    const world = await setupActiveRoom();
    await proposeDnsChange(world);
    const realNow = world.ctx.clock.now.bind(world.ctx.clock);
    world.ctx.clock.now = () => new Date(realNow().getTime() + 6 * 3600_000);

    await new NotificationDispatcher(world.ctx, { sender: mail }).tick();
    expect(mail.sent.filter((m) => m.subject.startsWith("Still waiting"))).toHaveLength(1);
  });

  it("respects a user's email opt-out", async () => {
    const world = await setupActiveRoom();
    await setEmailNotifications(world.ctx, world.orgB.userId, false);
    await proposeDnsChange(world);
    await new NotificationDispatcher(world.ctx, { sender: mail }).tick();
    expect(mail.sent.filter((m) => m.subject.includes("Approval needed"))).toHaveLength(0);
  });
});

describe("dispatcher resilience", () => {
  it("retries a failing send and gives up after maxAttempts", async () => {
    const world = await setupActiveRoom();
    await proposeDnsChange(world);

    let attempts = 0;
    const flaky = {
      kind: "flaky",
      async send() {
        attempts += 1;
        throw new Error("smtp unavailable");
      },
    };
    const dispatcher = new NotificationDispatcher(world.ctx, { sender: flaky, maxAttempts: 2 });

    const realNow = world.ctx.clock.now.bind(world.ctx.clock);
    let offset = 0;
    world.ctx.clock.now = () => new Date(realNow().getTime() + offset);

    await dispatcher.tick();
    expect(attempts).toBeGreaterThan(0);

    // After backoff, it is retried; after maxAttempts it stops being retried.
    for (let i = 0; i < 5; i++) {
      offset += 30 * 60_000;
      await dispatcher.tick();
    }
    const notifications = await world.ctx.store.listNotifications();
    const approval = notifications.find((n) => n.kind === "approval_pending");
    expect(approval?.status).toBe("FAILED");
    expect(approval?.lastError).toContain("smtp unavailable");
  });

  it("a mail failure never breaks the operation that triggered it", async () => {
    const world = await setupActiveRoom();
    // A sender that always throws must not prevent the approval being held.
    setEmailSender(
      { kind: "broken", async send() { throw new Error("boom"); } },
      { enabled: true, from: "x@y.example", appUrl: "https://booth.example" },
    );
    const approvalId = await proposeDnsChange(world);
    expect(approvalId).toBeTruthy();
    const approval = await world.ctx.store.getApproval(approvalId);
    expect(approval?.status).toBe("PENDING");
  });
});
