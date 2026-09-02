import { describe, expect, it } from "vitest";
import { parseCandidateEvents } from "../src/anthropic.js";
import { AgentCard, agentCardHash, extractCandidateEvents } from "../src/a2a.js";

describe("parseCandidateEvents (LLM output is untrusted)", () => {
  it("parses a valid events envelope", () => {
    const events = parseCandidateEvents(
      JSON.stringify({ events: [{ type: "message", text: "hello" }] }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.body).toMatchObject({ type: "message", text: "hello" });
  });

  it("parses fenced JSON", () => {
    const events = parseCandidateEvents(
      'Sure! ```json\n{"events":[{"type":"clarification_request","question":"Which region?"}]}\n```',
    );
    expect(events).toHaveLength(1);
  });

  it("drops malformed events instead of coercing", () => {
    expect(parseCandidateEvents('{"events":[{"type":"nonsense"}]}')).toHaveLength(0);
    expect(parseCandidateEvents("not json at all")).toHaveLength(0);
    expect(
      parseCandidateEvents('{"events":[{"type":"message"}]}'), // missing text
    ).toHaveLength(0);
  });

  it("caps the number of events per turn", () => {
    const many = { events: Array.from({ length: 10 }, (_, i) => ({ type: "message", text: `m${i}` })) };
    expect(parseCandidateEvents(JSON.stringify(many)).length).toBeLessThanOrEqual(2);
  });
});

describe("A2A agent card pinning", () => {
  const card = AgentCard.parse({
    protocolVersion: "1.0.0",
    name: "Infra Agent",
    url: "https://agents.cloudco.example/a2a",
    version: "2.1.0",
    skills: [{ id: "migrate", name: "Migration" }],
  });

  it("hash is stable for identical cards", () => {
    expect(agentCardHash(card)).toBe(agentCardHash(structuredClone(card)));
  });

  it("hash changes when endpoint or skills change (rug-pull detection)", () => {
    expect(agentCardHash({ ...card, url: "https://evil.example/a2a" })).not.toBe(agentCardHash(card));
    expect(
      agentCardHash({ ...card, skills: [{ id: "exfil", name: "Exfiltrate" }] }),
    ).not.toBe(agentCardHash(card));
  });
});

describe("extractCandidateEvents (remote A2A responses are untrusted)", () => {
  it("extracts structured events from data parts", () => {
    const events = extractCandidateEvents({
      parts: [{ kind: "data", data: { events: [{ type: "message", text: "hi" }] } }],
    });
    expect(events).toHaveLength(1);
  });

  it("drops unknown structures silently", () => {
    expect(extractCandidateEvents({ parts: [{ kind: "data", data: { events: [{ type: "hack" }] } }] })).toHaveLength(0);
    expect(extractCandidateEvents(null)).toHaveLength(0);
    expect(extractCandidateEvents("garbage")).toHaveLength(0);
  });
});
