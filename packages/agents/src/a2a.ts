import { createHash } from "node:crypto";
import { z } from "zod";
import { CandidateRoomEvent, type CandidateRoomEvent as CandidateRoomEventT } from "@booth/shared";
import { canonicalize } from "@booth/audit";
import { safeFetch, SsrfError } from "./safeFetch.js";
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentHealth,
  AgentTurnInput,
  AgentTurnResult,
} from "./types.js";

/**
 * Native A2A adapter (Mode A).
 *
 * Discovers and validates the remote Agent Card, pins its hash, and exchanges
 * messages via JSON-RPC `message/send`. The wire client is a thin,
 * schema-validated implementation kept behind this adapter boundary so it can
 * be swapped for the official @a2a-js/sdk client without touching the
 * orchestrator; conformance against the official tooling is tracked in
 * docs/a2a.md.
 *
 * All remote responses are UNTRUSTED and are strictly parsed into candidate
 * events; anything unrecognized is dropped.
 */

export const AgentCard = z.object({
  protocolVersion: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  url: z.string().url(),
  version: z.string(),
  capabilities: z.object({ streaming: z.boolean().optional() }).passthrough().optional(),
  securitySchemes: z.record(z.unknown()).optional(),
  skills: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()).optional(),
});
export type AgentCard = z.infer<typeof AgentCard>;

export function agentCardHash(card: AgentCard): string {
  return createHash("sha256").update(canonicalize(card), "utf8").digest("hex");
}

export class AgentCardChangedError extends Error {
  constructor(public readonly expectedHash: string, public readonly actualHash: string) {
    super("Agent Card changed since approval; reapproval required");
    this.name = "AgentCardChangedError";
  }
}

export async function discoverAgentCard(
  baseUrl: string,
  opts: { allowHttpLoopbackForDev?: boolean } = {},
): Promise<{ card: AgentCard; hash: string }> {
  const url = new URL("/.well-known/agent-card.json", baseUrl).toString();
  const res = await safeFetch(url, {
    allowedContentTypes: ["application/json"],
    maxBytes: 256_000,
    allowHttpLoopbackForDev: opts.allowHttpLoopbackForDev,
  });
  if (res.status !== 200) throw new Error(`agent card fetch failed: HTTP ${res.status}`);
  const card = AgentCard.parse(JSON.parse(res.body));
  // The card's declared endpoint must also be a safe URL (re-checked on use).
  new URL(card.url);
  return { card, hash: agentCardHash(card) };
}

const JsonRpcResponse = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

export interface A2AAdapterConfig {
  /** Pinned card hash approved by a human. Mismatch => hard failure. */
  pinnedCardHash: string;
  /** Static bearer token, OR a vault reference resolved at connect time. */
  bearerToken?: string;
  credentialReference?: string;
  allowHttpLoopbackForDev?: boolean;
}

export class A2AAgentAdapter implements AgentAdapter {
  readonly adapterType = "A2A_NATIVE";
  private card: AgentCard | null = null;
  private bearer: string | undefined;
  private rpcId = 0;

  constructor(
    public readonly id: string,
    private readonly baseUrl: string,
    private readonly config: A2AAdapterConfig,
    private readonly vault?: import("./credentials.js").CredentialVault,
    private readonly organizationId?: string,
  ) {}

  async connect(): Promise<void> {
    const { card, hash } = await discoverAgentCard(this.baseUrl, this.config);
    // Rug-pull mitigation (spec §19): endpoint/skills/security changes since
    // approval require human reapproval.
    if (hash !== this.config.pinnedCardHash) {
      throw new AgentCardChangedError(this.config.pinnedCardHash, hash);
    }
    // Agent auth is HTTP-layer (spec §25): resolve a bearer from the vault at
    // connect time; never persist or log the token.
    this.bearer = this.config.bearerToken;
    if (!this.bearer && this.config.credentialReference && this.vault) {
      this.bearer = await this.vault.resolve(this.config.credentialReference, this.organizationId);
    }
    this.card = card;
  }

  async disconnect(): Promise<void> {
    this.card = null;
  }
  async cancel(): Promise<void> {}
  async health(): Promise<AgentHealth> {
    return { ok: this.card !== null, detail: this.card ? undefined : "not connected" };
  }
  async capabilities(): Promise<AgentCapabilities> {
    return { adapter: "A2A_NATIVE", streaming: false };
  }

  async executeTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
    if (!this.card) throw new Error("adapter not connected");

    // Map room context to an A2A message with a structured data part.
    const request = {
      jsonrpc: "2.0",
      id: ++this.rpcId,
      method: "message/send",
      params: {
        message: {
          role: "user",
          messageId: `${this.id}-${this.rpcId}`,
          contextId: input.roomId,
          parts: [
            {
              kind: "data",
              data: {
                taskContract: input.taskContract,
                recentEvents: input.recentEvents,
                pendingRequests: input.pendingRequests,
                completionState: input.completionState,
                guidance: input.guidance,
              },
            },
          ],
        },
      },
    };

    let res;
    try {
      res = await safeFetch(this.card.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.bearer ? { authorization: `Bearer ${this.bearer}` } : {}),
        },
        body: JSON.stringify(request),
        allowedContentTypes: ["application/json"],
        allowHttpLoopbackForDev: this.config.allowHttpLoopbackForDev,
        maxBytes: 1_000_000,
      });
    } catch (err) {
      if (err instanceof SsrfError) throw err;
      return { events: [], usage: {} };
    }

    const parsed = JsonRpcResponse.safeParse(JSON.parse(res.body));
    if (!parsed.success || parsed.data.error) return { events: [], usage: {} };

    return { events: extractCandidateEvents(parsed.data.result), usage: {} };
  }
}

/** Pull candidate events out of A2A data parts; drop everything malformed. */
export function extractCandidateEvents(result: unknown): CandidateRoomEventT[] {
  const events: CandidateRoomEventT[] = [];
  const parts: unknown[] = [];

  const collect = (msg: unknown) => {
    if (msg && typeof msg === "object" && Array.isArray((msg as { parts?: unknown[] }).parts)) {
      parts.push(...(msg as { parts: unknown[] }).parts);
    }
  };
  if (result && typeof result === "object") {
    collect(result); // Message result
    const task = result as { status?: { message?: unknown }; artifacts?: unknown[] };
    if (task.status?.message) collect(task.status.message);
    for (const a of task.artifacts ?? []) collect(a);
  }

  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const p = part as { kind?: string; data?: unknown; text?: string };
    if (p.kind === "data" && p.data && typeof p.data === "object") {
      const dataObj = p.data as { events?: unknown[] };
      for (const e of dataObj.events ?? []) {
        const c = CandidateRoomEvent.safeParse({ body: e });
        if (c.success) events.push(c.data);
      }
    } else if (p.kind === "text" && typeof p.text === "string" && p.text.trim()) {
      const c = CandidateRoomEvent.safeParse({ body: { type: "message", text: p.text.slice(0, 8000) } });
      if (c.success) events.push(c.data);
    }
  }
  return events.slice(0, 4);
}
