import { describe, expect, it } from "vitest";
import {
  ConsoleEmailSender,
  MemoryEmailSender,
  approvalPendingEmail,
  createEmailSender,
  invitationEmail,
  securityAlertEmail,
} from "../src/index.js";

const base = { appUrl: "https://booth.example", recipientName: "Dana" };

describe("template disclosure rules", () => {
  it("an approval email names what needs deciding but never the parameters", () => {
    const msg = approvalPendingEmail({
      ...base,
      roomName: "Phoenix migration",
      roomId: "room_123",
      what: "change_dns",
      risk: "HIGH",
      requestedByOrg: "Meridian Cloud",
    });
    const all = `${msg.subject}\n${msg.text}\n${msg.html}`;
    expect(all).toContain("change_dns");
    expect(all).toContain("Phoenix migration");
    expect(all).toContain("https://booth.example/rooms/room_123");
    // The point of the rule: nothing that would let a reader act on the
    // content without signing in.
    expect(all).toContain("does not include the proposed parameters");
  });

  it("escapes untrusted values so a room name cannot inject markup", () => {
    const msg = approvalPendingEmail({
      ...base,
      roomName: '<img src=x onerror="alert(1)">',
      roomId: "room_1",
      what: "<script>bad()</script>",
      risk: "HIGH",
      requestedByOrg: "Evil & Co",
    });
    expect(msg.html).not.toContain("<img src=x");
    expect(msg.html).not.toContain("<script>bad()");
    expect(msg.html).toContain("&lt;script&gt;");
    expect(msg.html).toContain("Evil &amp; Co");
  });

  it("an invitation carries the token as a link and states the terms are reviewable", () => {
    const msg = invitationEmail({
      ...base,
      invitingOrganization: "Acme",
      roomName: "Vendor review",
      objective: "Complete the review",
      token: "tok_abc123",
      expiresAt: new Date("2026-09-05T10:00:00Z").toISOString(),
      personalNote: "Thanks!",
    });
    expect(msg.text).toContain("https://booth.example/invite?token=tok_abc123");
    expect(msg.text).toContain("Nothing is shared until you agree");
    expect(msg.text).toContain("Thanks!");
  });

  it("a security alert says what happened without quoting blocked content", () => {
    const msg = securityAlertEmail({
      ...base,
      roomName: "Phoenix",
      roomId: "room_9",
      severity: "CRITICAL",
      kind: "room_quarantined",
      detail: "repeated secret disclosure attempts",
    });
    expect(msg.subject).toContain("Security alert");
    expect(msg.text).toContain("room quarantined");
    expect(msg.text).toContain("https://booth.example/rooms/room_9");
  });
});

describe("sender selection", () => {
  it("is disabled by default", () => {
    const { sender, config } = createEmailSender({} as NodeJS.ProcessEnv);
    expect(sender.kind).toBe("noop");
    expect(config.enabled).toBe(false);
  });

  it("uses SMTP when a host is configured", () => {
    const { sender, config } = createEmailSender({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      APP_URL: "https://app.example.com/",
    } as NodeJS.ProcessEnv);
    expect(sender.kind).toBe("smtp");
    expect(config.enabled).toBe(true);
    // Trailing slash trimmed so links don't end up doubled.
    expect(config.appUrl).toBe("https://app.example.com");
  });

  it("can be explicitly switched off even with SMTP configured", () => {
    const { sender } = createEmailSender({
      SMTP_HOST: "smtp.example.com",
      BOOTH_EMAIL: "off",
    } as NodeJS.ProcessEnv);
    expect(sender.kind).toBe("noop");
  });

  it("console mode logs instead of sending", async () => {
    const lines: string[] = [];
    const sender = new ConsoleEmailSender((l) => lines.push(l));
    await sender.send({ to: "a@b.example", subject: "Hi", text: "Body" });
    expect(lines.join("")).toContain("a@b.example");
  });

  it("memory sender collects messages for assertions", async () => {
    const sender = new MemoryEmailSender();
    await sender.send({ to: "x@y.example", subject: "S", text: "T" });
    expect(sender.sent).toHaveLength(1);
  });
});
