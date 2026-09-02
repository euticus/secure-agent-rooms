import type {
  AgentAdapter,
  AgentCapabilities,
  AgentHealth,
  AgentTurnInput,
  AgentTurnResult,
} from "./types.js";
import type { CredentialVault } from "./credentials.js";
import { safeFetch } from "./safeFetch.js";
import {
  AdapterInvocationError,
  HOSTED_SYSTEM_PROMPT,
  buildHostedUserPayload,
  parseCandidateEvents,
  safeProviderDetail,
} from "./hosted.js";

/**
 * Hosted OpenAI-compatible agent adapter (Mode B).
 *
 * Speaks the OpenAI Chat Completions API, so a single adapter serves OpenAI,
 * Azure OpenAI, Google Gemini's OpenAI-compatible endpoint, OpenRouter, and
 * self-hosted/local models — configured via `baseUrl` + `model`. This is the
 * primary "any vendor" path alongside native A2A.
 *
 * The provider request goes through the SSRF-safe fetcher, so a malicious
 * `baseUrl` cannot be used to reach internal infrastructure. Everything the
 * model emits is a candidate event that must pass the enforcement pipeline.
 */
export interface OpenAIAdapterConfig {
  /** Chat Completions base URL, e.g. https://api.openai.com/v1 (default). */
  baseUrl?: string;
  model?: string;
  taskInstructions?: string;
  maxTokens?: number;
  /** Rough $/1M for input/output, used only for budget accounting. */
  inputCostPerM?: number;
  outputCostPerM?: number;
}

export class OpenAIAgentAdapter implements AgentAdapter {
  readonly adapterType = "HOSTED_OPENAI";
  private apiKey: string | null = null;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(
    public readonly id: string,
    private readonly credentialReference: string,
    private readonly vault: CredentialVault,
    private readonly config: OpenAIAdapterConfig = {},
    private readonly organizationId?: string,
  ) {
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.model = config.model ?? "gpt-4o";
  }

  async connect(): Promise<void> {
    this.apiKey = await this.vault.resolve(this.credentialReference, this.organizationId);
  }
  async disconnect(): Promise<void> {
    this.apiKey = null;
  }
  async cancel(): Promise<void> {}
  async health(): Promise<AgentHealth> {
    return { ok: this.apiKey !== null, detail: this.apiKey ? undefined : "not connected" };
  }
  async capabilities(): Promise<AgentCapabilities> {
    return { adapter: "HOSTED_OPENAI", model: this.model, streaming: false };
  }

  async executeTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
    if (!this.apiKey) throw new Error("adapter not connected");

    const payload = buildHostedUserPayload(input, this.config.taskInstructions ?? null);
    const requestBody = JSON.stringify({
      model: this.model,
      max_tokens: this.config.maxTokens ?? 4096,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: HOSTED_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
    });

    let res;
    try {
      res = await safeFetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: requestBody,
        allowedContentTypes: ["application/json"],
        maxBytes: 2_000_000,
        timeoutMs: 60_000,
      });
    } catch (err) {
      // Surface the failure instead of returning silence: a room that produces
      // nothing with no explanation is indistinguishable from a broken product.
      throw new AdapterInvocationError("OpenAI-compatible provider", null, safeProviderDetail(err));
    }
    if (res.status !== 200) {
      throw new AdapterInvocationError("OpenAI-compatible provider", res.status, safeProviderDetail(res.body));
    }

    let parsed: {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      parsed = JSON.parse(res.body);
    } catch {
      throw new AdapterInvocationError("OpenAI-compatible provider", res.status, "response was not valid JSON");
    }

    const text = parsed.choices?.[0]?.message?.content ?? "";
    const inputTokens = parsed.usage?.prompt_tokens ?? 0;
    const outputTokens = parsed.usage?.completion_tokens ?? 0;
    const usage = {
      inputTokens,
      outputTokens,
      estimatedCostUsd:
        (inputTokens / 1e6) * (this.config.inputCostPerM ?? 2.5) +
        (outputTokens / 1e6) * (this.config.outputCostPerM ?? 10),
    };
    return { events: parseCandidateEvents(text), usage };
  }
}
