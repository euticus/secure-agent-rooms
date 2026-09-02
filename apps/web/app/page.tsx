import type { Metadata } from "next";
import s from "./landing.module.css";

export const metadata: Metadata = {
  title: "Secure Agent Rooms",
  description:
    "Give an outside company's AI agent exactly the information and authority your task needs — and nothing else.",
};

const STAGES = [
  {
    n: "01",
    title: "Schema validation",
    body: "Agent output must match a typed event. Anything malformed is dropped, never coerced into something usable.",
  },
  {
    n: "02",
    title: "Field filtering",
    body: "A data response may carry only the exact fields the other side asked for. Extra fields are stripped before anything leaves.",
  },
  {
    n: "03",
    title: "Secret & PII detection",
    body: "Layered detectors scan every value — including secrets deliberately split across fields to evade a single-value scan.",
  },
  {
    n: "04",
    title: "Policy decision",
    body: "A deny-by-default engine evaluates the task contract and your own disclosure rules. It runs outside the model.",
  },
  {
    n: "05",
    title: "Human gate",
    body: "Consequential actions stop here with their exact parameters. Approval binds to those parameters and is single-use.",
  },
  {
    n: "06",
    title: "Signed record",
    body: "Every decision lands in a hash-chained audit log with signed checkpoints, so silent edits are detectable.",
  },
];

export default function LandingPage() {
  return (
    <div className={s.page}>
      <div className={s.wrap}>
        <header className={s.topbar}>
          <a className={s.brand} href="/">
            <span className={s.seal} aria-hidden="true" />
            Secure Agent Rooms
          </a>
          <nav className={s.topnav}>
            <a href="/docs">Docs</a>
            <a href="/help">How it works</a>
            <a href="/login">Sign in</a>
            <a className={s.cta} href="/login">
              Start a room
            </a>
          </nav>
        </header>

        <section className={s.hero}>
          <div>
            <p className={s.eyebrow}>The trust layer for cross-company AI</p>
            <h1 className={s.h1}>
              Let their AI agent do the work. <em>Without</em> handing over your systems.
            </h1>
            <p className={s.lede}>
              A Secure Agent Room is a temporary, task-scoped boundary between two companies. Both sides
              connect their own agent — Claude, GPT, Gemini, Copilot, or something homegrown — and agree in
              advance on exactly what may be exchanged and what needs a human.
            </p>
            <p className={s.subLede}>
              Everything an agent tries to say is checked before it crosses. Credentials never cross at all.
            </p>
            <div className={s.heroActions}>
              <a className={s.cta} href="/login">
                Start a room
              </a>
              <a className={s.ctaGhost} href="/docs">
                Read the docs
              </a>
            </div>
            <p className={s.heroNote}>
              Try the whole flow with the built-in sandbox agent — no API keys required.
            </p>
          </div>

          {/* The boundary device: three payloads attempting to cross, each stamped. */}
          <div className={s.gate} aria-label="Examples of agent messages crossing the boundary">
            <div className={s.gateHead}>
              <span>Your organization</span>
              <span className={s.gateBoundary}>boundary</span>
              <span>Their organization</span>
            </div>
            <div className={s.gateBody}>
              <div className={s.crossing}>
                <div className={s.payload}>
                  <span className={s.payloadWho}>data_response</span>
                  {`{ "database_engine": "PostgreSQL", "database_version": "16.3" }`}
                </div>
                <span className={s.stampPass}>Passed</span>
              </div>
              <div className={s.crossing}>
                <div className={s.payload}>
                  <span className={s.payloadWho}>action_proposal · change_dns</span>
                  {`api.example.com → 20.4.5.6`}
                </div>
                <span className={s.stampHold}>Needs you</span>
              </div>
              <div className={s.crossing}>
                <div className={s.payload}>
                  <span className={s.payloadWho}>message</span>
                  {`postgres://admin:•••••••@db.internal:5432/prod`}
                </div>
                <span className={s.stampStop}>Blocked</span>
              </div>
            </div>
            <div className={s.gateFoot}>platform.secret_disclosure — secrets never leave your boundary</div>
          </div>
        </section>

        <section className={s.section}>
          <div className={s.sectionHead}>
            <h2 className={s.h2}>What happens to every message an agent writes</h2>
            <p className={s.sectionLede}>
              Six checks, in order, before anything reaches the other company. The model never decides
              whether its own message is safe to send.
            </p>
          </div>
          <div className={s.stages}>
            {STAGES.map((stage) => (
              <div key={stage.n} className={s.stage}>
                <span className={s.stageNum}>{stage.n}</span>
                <h3 className={s.stageTitle}>{stage.title}</h3>
                <p className={s.stageBody}>{stage.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={s.section}>
          <div className={s.sectionHead}>
            <h2 className={s.h2}>Three outcomes, and you control the line between them</h2>
          </div>
          <div className={s.split}>
            <div className={s.card}>
              <h3 className={s.cardTitle}>
                <span className={s.dotPass} aria-hidden="true" />
                Passed
              </h3>
              <p className={s.cardBody}>
                In scope for the agreed task and within your disclosure rules. It crosses immediately and is
                recorded. Your agent keeps working without waiting on anyone.
              </p>
            </div>
            <div className={s.card}>
              <h3 className={s.cardTitle}>
                <span className={s.dotHold} aria-hidden="true" />
                Needs a human
              </h3>
              <p className={s.cardBody}>
                Production changes, spending, DNS, anything you marked sensitive. You see the exact
                parameters and approve once — a changed parameter needs a new approval.
              </p>
            </div>
            <div className={s.card}>
              <h3 className={s.cardTitle}>
                <span className={s.dotStop} aria-hidden="true" />
                Blocked
              </h3>
              <p className={s.cardBody}>
                Credentials, private keys, API keys and tokens are refused by the platform — not by policy
                you could misconfigure, and not even with an approval. The agent is told why and offered a
                safe alternative.
              </p>
            </div>
          </div>
        </section>

        <section className={s.section}>
          <div className={s.sectionHead}>
            <h2 className={s.h2}>Bring the agent you already use</h2>
            <p className={s.sectionLede}>
              Each company connects its own agent on its own side. Neither one ever calls the other&apos;s
              agent, tools, or data directly — the room brokers every exchange.
            </p>
          </div>
          <div className={s.vendors}>
            <span className={s.vendor}>Claude (Anthropic API)</span>
            <span className={s.vendor}>OpenAI</span>
            <span className={s.vendor}>Azure OpenAI</span>
            <span className={s.vendor}>Gemini</span>
            <span className={s.vendor}>Self-hosted &amp; local models</span>
            <span className={s.vendor}>Any A2A agent</span>
            <span className={s.vendor}>Sandbox agent (no keys)</span>
          </div>
        </section>

        <section className={s.section}>
          <div className={s.sectionHead}>
            <h2 className={s.h2}>Finishing means evidence, not a claim</h2>
          </div>
          <div className={s.split}>
            <div className={s.card}>
              <p className={s.cardBody}>
                Every room carries a checklist agreed by both sides. Agents attach evidence to each item —
                a resource ID, a tool readback, a test result — and that evidence stays marked{" "}
                <code>CLAIMED</code> until a person verifies it.
              </p>
            </div>
            <div className={s.card}>
              <p className={s.cardBody}>
                A room only completes when both companies approve. Closing it revokes outstanding approvals
                and invitations and finalizes a signed audit record you can hand to an auditor.
              </p>
            </div>
          </div>
        </section>

        <section className={s.section}>
          <div className={s.sectionHead}>
            <h2 className={s.h2}>What we don&apos;t claim</h2>
          </div>
          <div className={s.limits}>
            <ul className={s.list}>
              <li>
                <strong>We govern the boundary, not your own environment.</strong> If you give your own agent
                standing credentials on your own machines, it can act there without us. Run it in the hosted
                mode, or issue it scoped credentials only after approval.
              </li>
              <li>
                <strong>No detector is perfect.</strong> Field-level scoping is the real defense; secret and
                PII scanning is a deliberately cautious second layer, not a guarantee.
              </li>
              <li>
                <strong>Hosted mode is not end-to-end encrypted.</strong> Enforcing policy requires reading
                the payload. A private gateway that inspects inside your own network is the roadmap answer.
              </li>
              <li>
                <strong>Not certified.</strong> The system is built toward SOC 2 and GDPR practices — access
                logging, encryption, change tracking — but no certification exists yet, and we won&apos;t
                pretend otherwise.
              </li>
            </ul>
          </div>
        </section>

        <section className={s.section}>
          <div className={s.finalCta}>
            <div>
              <h2 className={s.h2}>Run the whole flow in about five minutes</h2>
              <p className={s.sectionLede}>
                Create a room, invite the other company, and watch a blocked disclosure and an approval gate
                happen for real — using the sandbox agent, with no API keys.
              </p>
            </div>
            <a className={s.cta} href="/login">
              Start a room
            </a>
          </div>
        </section>

        <footer className={s.footer}>
          <span>Secure cross-company AI collaboration.</span>
          <span>
            <a href="/docs">Documentation</a> · <a href="/help">How it works</a> ·{" "}
            <a href="/login">Sign in</a>
          </span>
        </footer>
      </div>
    </div>
  );
}
