import { describe, expect, it } from "vitest";
import { ScriptedAgentAdapter } from "@booth/agents";
import {
  RoomOrchestrator,
  approveCompletion,
  decideApproval,
  submitCandidateEvent,
  verifyAudit,
  verifyEvidence,
  closeRoom,
} from "../src/index.js";
import { setupActiveRoom } from "./helpers.js";

describe("end-to-end collaboration flow", () => {
  it("runs data exchange, approval-gated action, evidence, dual completion, close", async () => {
    const world = await setupActiveRoom();
    const { ctx, roomId, orgA, orgB } = world;

    // Agent A asks for database details.
    const req = await submitCandidateEvent(ctx, orgA.participantId, {
      body: {
        type: "data_request",
        purpose: "determine migration strategy",
        requestedFields: ["database_engine", "database_version"],
      },
    });
    expect(req.status).toBe("allowed");
    const requestId = req.status === "allowed" ? req.event.id : "";

    // Agent B answers with structured data (its own gateway filtered secrets upstream).
    const res = await submitCandidateEvent(ctx, orgB.participantId, {
      body: {
        type: "data_response",
        requestId,
        data: { database_engine: "PostgreSQL", database_version: "16.3", extra_field: "dropped" },
      },
      declaredClassification: { sensitivity: "CONFIDENTIAL", categories: ["infrastructure_metadata"] },
    });
    expect(res.status).toBe("allowed");
    // Structural filtering: only requested fields leave the organization.
    if (res.status === "allowed") {
      expect(res.event.body).toMatchObject({
        data: { database_engine: "PostgreSQL", database_version: "16.3" },
      });
      expect((res.event.body as { data: Record<string, unknown> }).data.extra_field).toBeUndefined();
    }

    // Approval-required action: DNS change.
    const action = await submitCandidateEvent(ctx, orgB.participantId, {
      body: {
        type: "action_proposal",
        action: "change_dns",
        parameters: { record: "api.example.com", from: "52.1.2.3", to: "20.4.5.6" },
        reason: "Production cutover",
      },
    });
    expect(action.status).toBe("requires_approval");
    const approvalId = action.status === "requires_approval" ? action.approvalId : "";

    // Human of the acting org approves the exact parameters.
    const decided = await decideApproval(ctx, orgB.userId, approvalId, "approve");
    expect(decided.status).toBe("APPROVED");

    // Evidence submissions for both criteria.
    for (const [criterionId, evidenceType] of [
      ["inventory", "tool_readback"],
      ["plan", "document"],
    ] as const) {
      const ev = await submitCandidateEvent(ctx, orgB.participantId, {
        body: {
          type: "evidence_submission",
          criterionId,
          evidenceType,
          description: `Evidence for ${criterionId}`,
          reference: `ref-${criterionId}`,
        },
        declaredClassification: { sensitivity: "INTERNAL", categories: ["infrastructure_metadata"] },
      });
      expect(ev.status).toBe("allowed");
    }
    // Humans verify the claimed evidence.
    for (const e of await ctx.store.listEvidence(roomId)) {
      await verifyEvidence(ctx, orgB.userId, roomId, e.id);
    }

    // Completion proposal moves the room to COMPLETION_PROPOSED.
    const done = await submitCandidateEvent(ctx, orgB.participantId, {
      body: { type: "completion_proposal", summary: "Migration plan complete" },
    });
    expect(done.status).toBe("allowed");
    expect((await ctx.store.getRoom(roomId))?.state).toBe("COMPLETION_PROPOSED");

    // Dual human approval.
    await approveCompletion(ctx, orgA.userId, roomId);
    expect((await ctx.store.getRoom(roomId))?.state).toBe("COMPLETION_PROPOSED");
    await approveCompletion(ctx, orgB.userId, roomId);
    expect((await ctx.store.getRoom(roomId))?.state).toBe("COMPLETED");

    // Close and verify the tamper-evident audit trail.
    await closeRoom(ctx, orgA.userId, roomId);
    expect((await ctx.store.getRoom(roomId))?.state).toBe("CLOSED");
    const integrity = await verifyAudit(ctx);
    expect(integrity.chainValid).toBe(true);
    expect(integrity.checkpointsValid).toBe(true);
  });

  it("orchestrates scripted agents through the pipeline", async () => {
    const world = await setupActiveRoom();
    const { ctx, roomId, orgA, orgB } = world;

    const agentA = new ScriptedAgentAdapter("agent-a", [
      () => [
        {
          body: {
            type: "data_request",
            purpose: "sizing",
            requestedFields: ["database_size_gb"],
          },
        },
      ],
      () => [{ body: { type: "message", text: "Thanks, drafting the plan now." } }],
    ]);
    const agentB = new ScriptedAgentAdapter("agent-b", [
      (input) => {
        const pending = input.pendingRequests[0];
        if (!pending) return [{ body: { type: "message", text: "Standing by." } }];
        return [
          {
            body: {
              type: "data_response",
              requestId: pending.eventId,
              data: { database_size_gb: 840 },
            },
            declaredClassification: { sensitivity: "CONFIDENTIAL", categories: ["infrastructure_metadata"] },
          },
        ];
      },
    ]);

    const orchestrator = new RoomOrchestrator(ctx, roomId);
    orchestrator.register((await ctx.store.getParticipant(orgA.participantId))!, agentA);
    orchestrator.register((await ctx.store.getParticipant(orgB.participantId))!, agentB);
    await orchestrator.runLoop(6);

    const events = await ctx.store.listRoomEvents(roomId);
    const types = events.map((e) => e.type);
    expect(types).toContain("data_request");
    expect(types).toContain("data_response");
    const room = await ctx.store.getRoom(roomId);
    expect(room?.usage.turns).toBeGreaterThan(0);
  });
});
