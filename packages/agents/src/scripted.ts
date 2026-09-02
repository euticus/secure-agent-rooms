import type { CandidateRoomEvent } from "@booth/shared";
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentHealth,
  AgentTurnInput,
  AgentTurnResult,
} from "./types.js";

export type ScriptStep = (input: AgentTurnInput) => CandidateRoomEvent[];

/**
 * Deterministic adapter used by the demo and the security test suite.
 * Steps run in order; when exhausted the agent stays silent. A step function
 * can inspect the turn input (pending requests, guidance, completion state).
 */
export class ScriptedAgentAdapter implements AgentAdapter {
  readonly adapterType = "SCRIPTED";
  private cursor = 0;

  constructor(
    public readonly id: string,
    private readonly steps: ScriptStep[],
  ) {}

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
    const step = this.steps[this.cursor];
    if (!step) return { events: [], usage: {} };
    this.cursor += 1;
    return { events: step(input), usage: {} };
  }
}
