import type { CandidateRoomEvent } from "@booth/shared";
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentHealth,
  AgentTurnInput,
  AgentTurnResult,
} from "./types.js";

/**
 * Deterministic, zero-credential agent used by the built-in "Sandbox agent"
 * connection type. It plays its room role from the current room state so a
 * team can trial the full collaboration + policy + approval + evidence flow
 * without connecting any external LLM. It never emits secrets and progresses
 * the task toward completion so demos terminate.
 *
 * This is NOT an LLM. It is a fixed policy that reacts to the scoped turn input.
 */
export class HeuristicAgentAdapter implements AgentAdapter {
  readonly adapterType = "SCRIPTED";

  constructor(public readonly id: string) {}

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async cancel(): Promise<void> {}
  async health(): Promise<AgentHealth> {
    return { ok: true };
  }
  async capabilities(): Promise<AgentCapabilities> {
    return { adapter: "SCRIPTED", streaming: false };
  }

  async executeTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
    const events = input.role === "customer" ? this.customerTurn(input) : this.providerTurn(input);
    return { events, usage: { estimatedCostUsd: 0 } };
  }

  private hasSent(input: AgentTurnInput, type: string): boolean {
    return input.recentEvents.some(
      (e) => e.senderParticipantId === input.participantId && e.type === type,
    );
  }

  private customerTurn(input: AgentTurnInput): CandidateRoomEvent[] {
    // 1. Answer any pending request addressed to us.
    const pending = input.pendingRequests[0];
    if (pending && pending.type === "data_request") {
      return [this.answer(pending)];
    }
    // 2. Open the conversation with a scoped data request.
    if (!this.hasSent(input, "data_request")) {
      const fields = this.requestFieldsFor(input);
      return [
        {
          body: {
            type: "data_request",
            purpose: `Gather inputs to plan: ${input.taskContract.objective.slice(0, 200)}`,
            requestedFields: fields,
          },
        },
      ];
    }
    // 3. Once every criterion has evidence, accept and stay quiet.
    const allEvidenced = input.completionState.criteria.every((c) => c.state !== "PENDING");
    if (allEvidenced && !this.hasSent(input, "message")) {
      return [{ body: { type: "message", text: "Inputs received and plan requirements met. Ready to complete." } }];
    }
    return [];
  }

  private providerTurn(input: AgentTurnInput): CandidateRoomEvent[] {
    // 1. Answer any pending data request (non-secret placeholder values).
    const pending = input.pendingRequests[0];
    if (pending && pending.type === "data_request") {
      return [this.answer(pending)];
    }
    if (pending && pending.type === "clarification_request") {
      return [
        {
          body: {
            type: "clarification_response",
            requestId: pending.eventId,
            answer: "Confirmed. Proceeding within the approved scope of the task contract.",
          },
        },
      ];
    }
    // 2. Submit evidence for the next criterion lacking it.
    const nextPending = input.completionState.criteria.find((c) => c.state === "PENDING");
    if (nextPending) {
      return [
        {
          body: {
            type: "evidence_submission",
            criterionId: nextPending.id,
            evidenceType: "tool_readback",
            description: `Completed: ${nextPending.description}`,
            reference: `sandbox://evidence/${nextPending.id}`,
          },
          declaredClassification: { sensitivity: "INTERNAL", categories: ["infrastructure_metadata"] },
        },
      ];
    }
    // 3. All criteria evidenced -> propose completion.
    if (!this.hasSent(input, "completion_proposal")) {
      return [{ body: { type: "completion_proposal", summary: "All completion criteria addressed with evidence." } }];
    }
    return [];
  }

  private answer(pending: { eventId: string; body: unknown }): CandidateRoomEvent {
    const requested = ((pending.body as { requestedFields?: string[] }).requestedFields ?? []).slice(0, 16);
    const data: Record<string, string | number | boolean | null> = {};
    for (const field of requested) data[field] = this.placeholderFor(field);
    return {
      body: { type: "data_response", requestId: pending.eventId, data },
      declaredClassification: { sensitivity: "CONFIDENTIAL", categories: ["infrastructure_metadata"] },
    };
  }

  /** Non-secret, plausible placeholder values keyed on field-name hints. */
  private placeholderFor(field: string): string | number | boolean {
    const f = field.toLowerCase();
    if (f.includes("engine")) return "PostgreSQL";
    if (f.includes("version")) return "16.3";
    if (f.includes("size") || f.includes("gb")) return 840;
    if (f.includes("region")) return "us-east-1";
    if (f.includes("count") || f.includes("num")) return 12;
    if (f.includes("enabled") || f.includes("has")) return true;
    if (f.includes("os")) return "Ubuntu 22.04 LTS";
    if (f.includes("runtime") || f.includes("language")) return "Node.js 20";
    if (f.includes("provider") || f.includes("cloud")) return "AWS";
    return "not-applicable";
  }

  private requestFieldsFor(input: AgentTurnInput): string[] {
    const permitted = input.taskContract.permittedDataClasses.join(" ");
    const base = ["environment_provider", "resource_count", "region"];
    if (permitted.includes("performance")) base.push("peak_requests_per_second");
    if (permitted.includes("network")) base.push("network_requirements");
    return base.slice(0, 6);
  }
}
