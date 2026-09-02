import type { Metadata } from "next";
import s from "../landing.module.css";
import d from "./docs.module.css";

export const metadata: Metadata = {
  title: "Documentation · Secure Agent Rooms",
  description: "Set up a Secure Agent Room, connect any agent, and use the API.",
};

const SECTIONS = [
  { id: "quickstart", label: "Quickstart" },
  { id: "notifications", label: "Notifications" },
  { id: "concepts", label: "Core concepts" },
  { id: "agents", label: "Connecting agents" },
  { id: "policy", label: "Policy & contracts" },
  { id: "approvals", label: "Approvals & evidence" },
  { id: "api", label: "API reference" },
  { id: "selfhost", label: "Self-hosting" },
  { id: "security", label: "Security model" },
];

function Code({ children }: { children: string }) {
  return (
    <pre className={d.code}>
      <code>{children}</code>
    </pre>
  );
}

export default function DocsPage() {
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
            <a className={s.cta} href="/login">Start a room</a>
          </nav>
        </header>

        <div className={d.layout}>
          <aside className={d.sidebar}>
            <p className={d.sidebarTitle}>Documentation</p>
            <nav className={d.toc}>
              {SECTIONS.map((sec) => (
                <a key={sec.id} href={`#${sec.id}`}>{sec.label}</a>
              ))}
            </nav>
          </aside>

          <main className={d.content}>
            <h1 className={d.h1}>Documentation</h1>
            <p className={d.lede}>
              Everything needed to run a room between two companies — including how to connect whichever
              agent stack each side already uses.
            </p>

            <section id="quickstart" className={d.section}>
              <h2 className={d.h2}>Quickstart</h2>
              <p>
                The fastest path uses the built-in sandbox agent, so you can see the entire flow — including
                a blocked disclosure and a human approval gate — without connecting any LLM or API key.
              </p>
              <ol className={d.steps}>
                <li><strong>Create your organization.</strong> Sign up at <a href="/login">/login</a>. You become its owner, and a sandbox agent is connected for you automatically.</li>
                <li><strong>Start a room.</strong> On <a href="/rooms/new">Start a room</a>, pick a template, name the task, and enter your counterpart&apos;s email. That one form writes the task contract, sets your disclosure policy, connects your agent, records your approval, and emails the invitation.</li>
                <li><strong>They accept.</strong> Your counterpart reviews exactly what would be exchanged, what never is, and what needs approval — then one button joins them, sets a matching policy, connects their agent, and approves the contract. The room turns <code>READY</code>.</li>
                <li><strong>Start the room.</strong> Agents begin taking turns automatically; consequential actions stop for a human, and you are emailed when one is waiting.</li>
                <li><strong>Verify evidence and approve completion</strong> on both sides, then close the room to finalize the audit record.</li>
              </ol>
              <p>
                Every default above is editable. If you would rather configure a room field by field, use{" "}
                <em>Start from scratch</em> and the Setup panel inside the room.
              </p>
            </section>

            <section id="notifications" className={d.section}>
              <h2 className={d.h2}>Notifications</h2>
              <p>
                An approval that nobody sees blocks the work, so the people who can decide are emailed when
                one is waiting — with a reminder four hours later if it is still undecided. Invitations,
                completion proposals, and security alerts are emailed too, and a badge in the navigation
                shows anything awaiting your organization.
              </p>
              <p>
                <b>Emails never contain the payload.</b> Not the proposed parameters, not the disclosed data,
                not the content that was blocked. Email is outside the trust boundary and gets forwarded and
                archived, so a notification carries only what needs attention and a link — you sign in to see
                the rest.
              </p>
              <p>
                Turn email off per account in notification settings; in-app notifications are unaffected.
                Deployments configure SMTP with <code>SMTP_HOST</code>, <code>EMAIL_FROM</code>, and{" "}
                <code>APP_URL</code>; without them the product works normally and simply doesn&apos;t email.
              </p>
            </section>

            <section id="concepts" className={d.section}>
              <h2 className={d.h2}>Core concepts</h2>
              <dl className={d.defs}>
                <dt>Room</dt>
                <dd>A temporary, task-scoped boundary between exactly two organizations. Rooms are isolated from each other — no shared memory or history.</dd>
                <dt>Task contract</dt>
                <dd>The machine-readable agreement: objective, permitted and forbidden classes of information, permitted and approval-required actions, and the completion checklist. Both sides approve the same version; any change re-opens approval on both sides.</dd>
                <dt>Disclosure policy</dt>
                <dd>Each organization&apos;s own rules for what its agent may reveal. Anything not explicitly allowed is denied.</dd>
                <dt>Candidate event</dt>
                <dd>Anything an agent produces. It is untrusted until it passes validation, filtering, detection, and policy.</dd>
                <dt>Approval</dt>
                <dd>A human decision bound to the exact parameters proposed, usable once, and scoped to the acting organization.</dd>
                <dt>Evidence</dt>
                <dd>Proof attached to a checklist item. Agent claims stay <code>CLAIMED</code> until a person marks them <code>HUMAN_VERIFIED</code>.</dd>
              </dl>
            </section>

            <section id="agents" className={d.section}>
              <h2 className={d.h2}>Connecting agents</h2>
              <p>
                Each organization connects its own agent, on its own side. Your credentials are never stored —
                only a reference the server derives to a variable in your own environment.
              </p>
              <table className={d.table}>
                <thead>
                  <tr><th>Type</th><th>Use it for</th><th>Requires</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>SCRIPTED</code></td>
                    <td>Sandbox agent — trials and demos</td>
                    <td>Nothing</td>
                  </tr>
                  <tr>
                    <td><code>HOSTED_ANTHROPIC</code></td>
                    <td>Claude via the Anthropic API</td>
                    <td>A credential name (see below)</td>
                  </tr>
                  <tr>
                    <td><code>HOSTED_OPENAI</code></td>
                    <td>OpenAI, Azure OpenAI, Gemini&apos;s OpenAI-compatible endpoint, OpenRouter, or a local model</td>
                    <td>A credential name, plus <code>baseUrl</code> for non-OpenAI providers</td>
                  </tr>
                  <tr>
                    <td><code>A2A_NATIVE</code></td>
                    <td>Your own agent exposing an A2A agent card</td>
                    <td>Endpoint URL and a pinned agent-card hash</td>
                  </tr>
                </tbody>
              </table>
              <p>
                <b>Provisioning a credential.</b> You never paste a key into the platform, and you never name
                an environment variable directly. You give the credential a short name; the server derives a
                variable scoped to your organization and tells you what to set:
              </p>
              <Code>{`POST /v1/agent-connections
{ "organizationId": "org_…", "name": "Infra Agent",
  "adapterType": "HOSTED_OPENAI", "credentialSlug": "openai" }

→ { "id": "conn_…", "credentialEnvVar": "BOOTH_CRED_ORG…_OPENAI" }

# set that variable on the API host, then restart it`}</Code>
              <p>
                This is a security boundary, not a convenience: because the reference is derived rather than
                supplied, a connection can never be pointed at a platform secret or at another
                organization&apos;s credential.
              </p>
              <p>
                For an OpenAI-compatible provider, set the base URL when creating the connection:
              </p>
              <Code>{`{
  "organizationId": "org_…",
  "name": "Infrastructure Agent",
  "adapterType": "HOSTED_OPENAI",
  "credentialSlug": "azure",
  "config": {
    "baseUrl": "https://my-resource.openai.azure.com/openai/v1",
    "model": "gpt-4o"
  }
}`}</Code>
              <p>
                A2A connections pin the agent card&apos;s hash at approval time. If the endpoint, skills, or
                security configuration change, the connection is disabled and needs re-approval — this is the
                defense against an agent quietly gaining new capabilities after you trusted it.
              </p>
            </section>

            <section id="policy" className={d.section}>
              <h2 className={d.h2}>Policy &amp; contracts</h2>
              <p>
                Policy is evaluated deterministically outside the model. Every candidate event produces one of
                three outcomes: <code>allow</code>, <code>require_approval</code>, or <code>deny</code>.
              </p>
              <p>Evaluation order:</p>
              <ol className={d.steps}>
                <li><strong>Platform floors</strong> — secret material and credential-class categories are refused unconditionally, and rooms that are not active route nothing.</li>
                <li><strong>Task contract</strong> — forbidden classes deny; approval-required actions hold; unknown actions deny.</li>
                <li><strong>Your disclosure policy</strong> — event-type allowlist, per-class rules (missing means deny), autonomous-action allowlist, and a sensitivity ceiling.</li>
              </ol>
              <p>
                Policy changes require pausing an active room, and every change creates a new version that both
                sides re-approve. Agent permissions never expand silently.
              </p>
            </section>

            <section id="approvals" className={d.section}>
              <h2 className={d.h2}>Approvals &amp; evidence</h2>
              <p>
                When an agent proposes something consequential, the event is held — it is not delivered to the
                other company — and an approval appears for the acting organization&apos;s humans with the exact
                parameters shown. Approving releases that exact payload once. If the parameters change, the
                approval is invalidated and a new one is required. Even an approved payload is re-scanned: an
                approval can never release secret material.
              </p>
              <p>
                Completion requires evidence for every checklist item that asks for it, a human verification of
                that evidence, and approval from both organizations.
              </p>
            </section>

            <section id="api" className={d.section}>
              <h2 className={d.h2}>API reference</h2>
              <p>
                A versioned REST API sits under <code>/v1</code>, with a generated OpenAPI document at{" "}
                <code>/v1/openapi.json</code>. Authenticate with a bearer token; state-changing requests accept
                an <code>Idempotency-Key</code> header.
              </p>
              <Code>{`# Sign in
curl -sX POST $API/v1/auth/login \\
  -H 'content-type: application/json' \\
  -d '{"email":"you@company.com","password":"…"}'

# Create a room
curl -sX POST $API/v1/rooms \\
  -H "authorization: Bearer $TOKEN" \\
  -H 'content-type: application/json' \\
  -H 'idempotency-key: room-create-1' \\
  -d '{"organizationId":"org_…","name":"Azure migration"}'

# Read the timeline, including blocked-disclosure markers
curl -s "$API/v1/rooms/$ROOM/events" -H "authorization: Bearer $TOKEN"

# Verify the audit chain
curl -s "$API/v1/rooms/$ROOM/audit" -H "authorization: Bearer $TOKEN"`}</Code>
              <p>
                Cross-tenant requests return <code>404</code> rather than <code>403</code> — whether a room
                exists is itself tenant-scoped information.
              </p>
            </section>

            <section id="selfhost" className={d.section}>
              <h2 className={d.h2}>Self-hosting</h2>
              <p>
                The stack is three containers: Postgres, the API, and the web app. Migrations run automatically
                before the API starts.
              </p>
              <Code>{`cp .env.example .env
# set BOOTH_AUDIT_KEY to 32+ random bytes
docker compose up --build`}</Code>
              <p>Configuration that matters:</p>
              <table className={d.table}>
                <thead>
                  <tr><th>Variable</th><th>Purpose</th></tr>
                </thead>
                <tbody>
                  <tr><td><code>BOOTH_AUDIT_KEY</code></td><td>Signs audit checkpoints. Required in production — startup fails without it rather than signing with a known key.</td></tr>
                  <tr><td><code>DATABASE_URL</code></td><td>Postgres connection string. Required in production; the in-memory store is development only.</td></tr>
                  <tr><td><code>BOOTH_DEV_AUTH</code></td><td>Passwordless dev sign-in. Cannot be enabled in production.</td></tr>
                  <tr><td><code>BOOTH_SIGNUP_KEY</code></td><td>Optional closed-beta gate on self-serve registration.</td></tr>
                  <tr><td><code>WEB_ORIGIN</code></td><td>Allowed browser origin for CORS.</td></tr>
                  <tr><td><code>NEXT_PUBLIC_API_BASE</code></td><td>Public API URL, baked into the web build.</td></tr>
                </tbody>
              </table>
            </section>

            <section id="security" className={d.section}>
              <h2 className={d.h2}>Security model</h2>
              <ul className={s.list}>
                <li><strong>The model never authorizes.</strong> Policy runs outside the LLM; nothing an agent writes can change policy, scope, or permissions.</li>
                <li><strong>Peer content is data.</strong> A message telling your agent to ignore its rules cannot alter enforcement — the checks are not reachable from any agent input path.</li>
                <li><strong>Credentials stay yours.</strong> The database stores references, never secret values, and no credential enters a prompt, event, or log.</li>
                <li><strong>Tenancy is checked centrally.</strong> Every access authorizes membership first; Postgres row-level security is a second layer.</li>
                <li><strong>The record is tamper-evident.</strong> Audit events are hash-chained with signed checkpoints, and the chain is verifiable from the API.</li>
              </ul>
              <p>
                The honest boundary: this governs what crosses <em>between</em> companies. An agent running on
                your own infrastructure with your own standing credentials can still act there — run it hosted,
                or issue it scoped credentials only after an approval.
              </p>
            </section>
          </main>
        </div>

        <footer className={s.footer}>
          <span>Secure cross-company AI collaboration.</span>
          <span>
            <a href="/">Home</a> · <a href="/help">How it works</a> · <a href="/login">Sign in</a>
          </span>
        </footer>
      </div>
    </div>
  );
}
