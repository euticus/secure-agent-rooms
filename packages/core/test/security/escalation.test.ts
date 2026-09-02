import { describe, expect, it } from "vitest";
import { escapeHtml } from "@booth/shared";
import { submitCandidateEvent } from "../../src/index.js";
import { setupActiveRoom } from "../helpers.js";

describe("policy escalation & injection surfaces (invariants 2, 10)", () => {
  it("agents cannot emit policy/authorization event types at all", async () => {
    const world = await setupActiveRoom();
    for (const type of [
      "policy_change",
      "approval_response",
      "action_authorized",
      "policy_block",
      "room_resume",
      "completion_acceptance",
    ]) {
      const r = await submitCandidateEvent(world.ctx, world.orgB.participantId, {
        body: { type, anything: "x" },
      });
      expect(r.status).toBe("rejected");
    }
  });

  it("agents cannot set trusted envelope fields (sequence, decision, sender)", async () => {
    const world = await setupActiveRoom();
    const r = await submitCandidateEvent(world.ctx, world.orgA.participantId, {
      body: { type: "message", text: "hello" },
      // Attempts to smuggle trusted fields are simply not part of the schema
      // and are discarded by parsing.
      sequence: 9999,
      policy: { decision: "allow" },
      senderParticipantId: world.orgB.participantId,
    } as never);
    expect(r.status).toBe("allowed");
    if (r.status === "allowed") {
      expect(r.event.senderParticipantId).toBe(world.orgA.participantId);
      expect(r.event.sequence).not.toBe(9999);
      expect(r.event.policy.decision).toBe("allow"); // server-computed, not client-set
    }
  });

  it("action not in contract is denied even if the participant allows it", async () => {
    const world = await setupActiveRoom();
    const r = await submitCandidateEvent(world.ctx, world.orgB.participantId, {
      body: {
        type: "action_proposal",
        action: "grant_admin_access",
        parameters: {},
        reason: "please",
      },
    });
    expect(r.status).toBe("denied");
  });

  it("oversized payloads are rejected by schema caps", async () => {
    const world = await setupActiveRoom();
    const r = await submitCandidateEvent(world.ctx, world.orgA.participantId, {
      body: { type: "message", text: "x".repeat(100_000) },
    });
    expect(r.status).toBe("rejected");
  });

  it("transcript XSS: script content stays inert data and escapes cleanly", async () => {
    const world = await setupActiveRoom();
    const payload = `<script>alert('xss')</script><img src=x onerror=alert(1)>`;
    const r = await submitCandidateEvent(world.ctx, world.orgA.participantId, {
      body: { type: "message", text: payload },
    });
    expect(r.status).toBe("allowed");
    const events = await world.ctx.store.listRoomEvents(world.roomId);
    const stored = events.find((e) => e.type === "message");
    // Stored verbatim as data — the platform never interprets it...
    expect((stored?.body as { text: string }).text).toBe(payload);
    // ...and the UI escaping helper renders it inert.
    const escaped = escapeHtml((stored?.body as { text: string }).text);
    expect(escaped).not.toContain("<script>");
    expect(escaped).not.toContain("<img");
  });
});
