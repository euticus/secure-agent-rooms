import type {
  CandidateRoomEvent,
  ExecutionBudget,
  SafeRoomEvent,
  TaskContract,
} from "@booth/shared";

export interface AgentCapabilities {
  adapter: string;
  model?: string;
  streaming: boolean;
}

export interface AgentHealth {
  ok: boolean;
  detail?: string;
}

export interface PendingRequest {
  eventId: string;
  type: "data_request" | "clarification_request";
  body: unknown;
}

export interface CompletionStateView {
  criteria: { id: string; description: string; state: string }[];
}

/**
 * Exactly what a participant agent is allowed to see for one turn — never the
 * whole room database, never the other org's internals (spec §33/§67).
 */
export interface AgentTurnInput {
  roomId: string;
  participantId: string;
  role: "customer" | "provider" | "peer";
  taskContract: TaskContract;
  permittedCapabilities: string[];
  recentEvents: SafeRoomEvent[];
  pendingRequests: PendingRequest[];
  completionState: CompletionStateView;
  remainingBudget: ExecutionBudget;
  /** Bounded feedback about the agent's last denied event, if any. */
  guidance: string | null;
}

export interface AgentTurnResult {
  events: CandidateRoomEvent[];
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
  };
}

/**
 * Agent Adapter interface (spec §66). Everything an adapter returns is
 * UNTRUSTED and enters the enforcement pipeline as candidate events.
 */
export interface AgentAdapter {
  id: string;
  adapterType: string;
  connect(): Promise<void>;
  capabilities(): Promise<AgentCapabilities>;
  executeTurn(input: AgentTurnInput): Promise<AgentTurnResult>;
  cancel(taskId: string): Promise<void>;
  health(): Promise<AgentHealth>;
  disconnect(): Promise<void>;
}
