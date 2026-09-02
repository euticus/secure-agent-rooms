export const ROOM_STATES = [
  "DRAFT",
  "INVITED",
  "NEGOTIATING",
  "READY",
  "ACTIVE",
  "PAUSED",
  "COMPLETION_PROPOSED",
  "COMPLETED",
  "CLOSED",
  "CANCELED",
  "QUARANTINED",
] as const;
export type RoomState = (typeof ROOM_STATES)[number];

/** Legal room state transitions. Anything not listed is rejected. */
const TRANSITIONS: Record<RoomState, readonly RoomState[]> = {
  DRAFT: ["INVITED", "CANCELED"],
  INVITED: ["NEGOTIATING", "CANCELED"],
  NEGOTIATING: ["READY", "CANCELED", "QUARANTINED"],
  READY: ["ACTIVE", "CANCELED", "QUARANTINED"],
  ACTIVE: ["PAUSED", "COMPLETION_PROPOSED", "CANCELED", "QUARANTINED"],
  PAUSED: ["ACTIVE", "CANCELED", "QUARANTINED"],
  COMPLETION_PROPOSED: ["ACTIVE", "COMPLETED", "CANCELED", "QUARANTINED"],
  COMPLETED: ["CLOSED"],
  CLOSED: [],
  CANCELED: ["CLOSED"],
  QUARANTINED: ["PAUSED", "CANCELED", "CLOSED"],
};

export function canTransition(from: RoomState, to: RoomState): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface ExecutionBudget {
  maxTurns: number;
  maxDurationMinutes: number;
  maxToolCalls: number;
  maxModelSpendUsd: number;
}

export const DEFAULT_BUDGET: ExecutionBudget = {
  maxTurns: 100,
  maxDurationMinutes: 120,
  maxToolCalls: 200,
  maxModelSpendUsd: 25,
};

export interface BudgetUsage {
  turns: number;
  toolCalls: number;
  startedAtMs: number | null;
  modelSpendUsd: number;
}

export function budgetExceeded(budget: ExecutionBudget, usage: BudgetUsage, nowMs: number): string | null {
  if (usage.turns >= budget.maxTurns) return "maxTurns";
  if (usage.toolCalls >= budget.maxToolCalls) return "maxToolCalls";
  if (usage.modelSpendUsd >= budget.maxModelSpendUsd) return "maxModelSpendUsd";
  if (usage.startedAtMs !== null && nowMs - usage.startedAtMs >= budget.maxDurationMinutes * 60_000) {
    return "maxDurationMinutes";
  }
  return null;
}
