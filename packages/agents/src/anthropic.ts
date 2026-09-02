import Anthropic from "@anthropic-ai/sdk";
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentHealth,
  AgentTurnInput,
  AgentTurnResult,
} from "./types.js";
import type { CredentialVault } from "./credentials.js";
import {
  AdapterInvocationError,
  HOSTED_SYSTEM_PROMPT,
  buildHostedUserPayload,
  parseCandidateEvents,
  safeProviderDetail,
} from "./hosted.js";

// Re-exported for backward compatibility (tests import from here).
export { parseCandidateEvents };

/**
 * Hosted Anthropic agent adapter (Mode B). See ./hosted.ts for the shared
 * hosted-LLM contract. Everything the model emits is a candidate event that
 * goes through the deterministic enforcement pipeline.
 */
export interface AnthropicAdapterConfig {
  model?: string;
  taskInstructions?: string;
  maxTokens?: number;
}

export class AnthropicAgentAdapter implements AgentAdapter {
  readonly adapterType = "HOSTED_ANTHROPIC";
  private client: Anthropic | null = null;
  private readonly model: string;

  constructor(
    public readonly id: string,
    private readonly credentialReference: string,
    private readonly vault: CredentialVault,
    private readonly config: AnthropicAdapterConfig = {},
    private readonly organizationId?: string,
  ) {
    this.model = config.model ?? "claude-opus-5";
  }

  async connect(): Promise<void> {
    // Credential resolved at connect time, held only in adapter memory.
    const apiKey = await this.vault.resolve(this.credentialReference, this.organizationId);
    this.client = new Anthropic({ apiKey });
  }

  async disconnect(): Promise<void> {
    this.client = null;
  }

  async cancel(): Promise<void> {}

  async health(): Promise<AgentHealth> {
    return { ok: this.client !== null, detail: this.client ? undefined : "not connected" };
  }

  async capabilities(): Promise<AgentCapabilities> {
    return { adapter: "HOSTED_ANTHROPIC", model: this.model, streaming: false };
  }

  async executeTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
    if (!this.client) throw new Error("adapter not connected");

    const payload = buildHostedUserPayload(input, this.config.taskInstructions ?? null);
    let response;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.config.maxTokens ?? 4096,
        system: HOSTED_SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(payload) }],
      });
    } catch (err) {
      const status = typeof (err as { status?: number }).status === "number" ? (err as { status: number }).status : null;
      throw new AdapterInvocationError("Anthropic", status, safeProviderDetail((err as Error)?.message ?? err));
    }

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      estimatedCostUsd:
        (response.usage.input_tokens / 1e6) * 5 + (response.usage.output_tokens / 1e6) * 25,
    };

    if (response.stop_reason === "refusal") return { events: [], usage };

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    return { events: parseCandidateEvents(text), usage };
  }
}
