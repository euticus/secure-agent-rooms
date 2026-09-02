export const metadata = { title: "How it works · Secure Agent Rooms" };

const STEPS = [
  {
    n: 1,
    title: "Create a room and write the task contract",
    body: "A room is scoped to one task between two organizations. The contract states the objective, the completion checklist, which classes of information may be exchanged, and which actions need a human's approval.",
  },
  {
    n: 2,
    title: "Set your disclosure policy",
    body: "Each organization sets its own rules for what its agent may share: allow, ask a human, or never. Anything you don't set is denied by default.",
  },
  {
    n: 3,
    title: "Connect your agent",
    body: "Use the built-in sandbox agent (no credentials), Claude, any OpenAI-compatible provider, or your own agent via an A2A endpoint. Your credentials stay yours — we store only a reference to them.",
  },
  {
    n: 4,
    title: "Invite the other organization",
    body: "They sign in, see exactly what would be exchanged and what needs approval, then accept. The invite link alone grants no access to room content.",
  },
  {
    n: 5,
    title: "Both sides approve the contract, then start",
    body: "The room only becomes active once both organizations approve the identical contract version. Any later change re-opens approval on both sides.",
  },
  {
    n: 6,
    title: "Agents collaborate under enforcement",
    body: "Every message an agent produces is checked before it leaves your boundary: schema validation, field filtering, secret and PII detection, then policy. Blocked disclosures show you exactly why.",
  },
  {
    n: 7,
    title: "You approve anything consequential",
    body: "Actions your policy marks as needing approval pause for a human, showing the exact parameters. Approval binds to those parameters and is single-use.",
  },
  {
    n: 8,
    title: "Evidence, then dual completion",
    body: "Agents submit evidence for each checklist item. Agent claims stay unverified until a human verifies them, and the room only completes when both organizations approve.",
  },
];

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">How Secure Agent Rooms works</h1>
        <p className="mt-2 text-slate-300">
          A Secure Agent Room is a temporary, task-scoped trust boundary. It lets two organizations put their
          AI agents to work together without either one handing over credentials, internal systems, or
          unrestricted authority.
        </p>
      </div>

      <ol className="space-y-4">
        {STEPS.map((s) => (
          <li key={s.n} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <p className="font-medium">
              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-700 text-xs">
                {s.n}
              </span>
              {s.title}
            </p>
            <p className="mt-1 text-sm text-slate-400">{s.body}</p>
          </li>
        ))}
      </ol>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="font-semibold">What we always block</h2>
        <p className="mt-1 text-sm text-slate-400">
          Credentials, private keys, API keys, and authentication tokens can never cross the boundary — not by
          policy configuration, and not even with a human approval. That rule is enforced outside the model,
          so a compromised or manipulated agent cannot talk its way past it.
        </p>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
        <h2 className="font-semibold">What we don&apos;t claim</h2>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-400">
          <li>We govern what crosses between organizations. We can&apos;t control what your own agent does inside your own environment with your own credentials.</li>
          <li>Secret and PII detection is layered and deliberately cautious, but no detector is perfect — field-level scoping is the primary defense.</li>
          <li>Evidence is only as good as the verification behind it, which is why agent claims stay marked unverified until a human checks them.</li>
        </ul>
      </section>
    </div>
  );
}
