import type { AgentAdapter } from "./types.js";
import type { CredentialVault } from "./credentials.js";
import { AnthropicAgentAdapter } from "./anthropic.js";
import { OpenAIAgentAdapter } from "./openai.js";
import { A2AAgentAdapter } from "./a2a.js";
import { HeuristicAgentAdapter } from "./heuristic.js";

/** Minimal stored-connection shape the factory needs (subset of AgentConnection). */
export interface AgentConnectionDescriptor {
  id: string;
  organizationId: string;
  adapterType: string;
  endpoint: string | null;
  agentCardHash: string | null;
  credentialReference: string | null;
  config: Record<string, unknown>;
}

export class UnsupportedAdapterError extends Error {
  constructor(public readonly adapterType: string) {
    super(`adapter type "${adapterType}" is not supported in this build`);
    this.name = "UnsupportedAdapterError";
  }
}

export class AdapterConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdapterConfigError";
  }
}

/**
 * Construct a live adapter from a persisted agent connection. Unknown or
 * unimplemented adapter types fail loudly rather than silently producing a
 * connection that can never run.
 *
 * The owning organization id is passed to every adapter so the credential
 * vault can enforce tenant scoping at resolution time — a tenant can only ever
 * resolve a credential provisioned in its own namespace.
 */
export function createAdapter(desc: AgentConnectionDescriptor, vault: CredentialVault): AgentAdapter {
  const cfg = desc.config ?? {};
  switch (desc.adapterType) {
    case "SCRIPTED":
      // The built-in zero-credential sandbox agent.
      return new HeuristicAgentAdapter(desc.id);

    case "HOSTED_ANTHROPIC":
      if (!desc.credentialReference) {
        throw new AdapterConfigError("HOSTED_ANTHROPIC connection requires a credentialReference");
      }
      return new AnthropicAgentAdapter(
        desc.id,
        desc.credentialReference,
        vault,
        {
          model: typeof cfg.model === "string" ? cfg.model : undefined,
          taskInstructions: typeof cfg.taskInstructions === "string" ? cfg.taskInstructions : undefined,
        },
        desc.organizationId,
      );

    case "HOSTED_OPENAI":
      if (!desc.credentialReference) {
        throw new AdapterConfigError("HOSTED_OPENAI connection requires a credentialReference");
      }
      return new OpenAIAgentAdapter(
        desc.id,
        desc.credentialReference,
        vault,
        {
          baseUrl: typeof cfg.baseUrl === "string" ? cfg.baseUrl : undefined,
          model: typeof cfg.model === "string" ? cfg.model : undefined,
          taskInstructions: typeof cfg.taskInstructions === "string" ? cfg.taskInstructions : undefined,
        },
        desc.organizationId,
      );

    case "A2A_NATIVE": {
      if (!desc.endpoint) throw new AdapterConfigError("A2A_NATIVE connection requires an endpoint");
      if (!desc.agentCardHash) {
        throw new AdapterConfigError("A2A_NATIVE connection requires a pinned agentCardHash (approve the agent card first)");
      }
      return new A2AAgentAdapter(
        desc.id,
        desc.endpoint,
        {
          pinnedCardHash: desc.agentCardHash,
          credentialReference: desc.credentialReference ?? undefined,
          allowHttpLoopbackForDev: cfg.allowHttpLoopbackForDev === true,
        },
        vault,
        desc.organizationId,
      );
    }

    case "MCP_BRIDGE":
    case "PRIVATE_GATEWAY":
      // Enum-valid but unimplemented in this build — reject explicitly.
      throw new UnsupportedAdapterError(desc.adapterType);

    default:
      throw new UnsupportedAdapterError(desc.adapterType);
  }
}

/** Adapter types that actually run in this build (for validation at connect time). */
export const SUPPORTED_ADAPTER_TYPES = ["SCRIPTED", "HOSTED_ANTHROPIC", "HOSTED_OPENAI", "A2A_NATIVE"] as const;

export function isSupportedAdapterType(t: string): boolean {
  return (SUPPORTED_ADAPTER_TYPES as readonly string[]).includes(t);
}
