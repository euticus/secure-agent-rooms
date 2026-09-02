# Go-to-Market Strategy

## The strategic read

This product has an unusual GTM shape, and getting the shape right matters more than any individual tactic.

**It is infrastructure sold on fear, adopted through a workflow.** Nobody wakes up wanting to buy "an agent trust layer." They wake up wanting the vendor onboarding done by Friday, or wanting to say yes to an AI-enabled vendor without their CISO blocking it. Sell the workflow; the security is why they're *allowed* to buy it.

**It is inherently two-sided.** Every room needs a counterparty. That is the single most important fact about this GTM: it is the distribution engine and the biggest adoption risk at the same time. Design for it explicitly rather than treating the second side as an afterthought.

**The buyer and the blocker are different people.** The buyer is the delivery leader who owns the timeline. The blocker is security. Most security products sell to the blocker; this one should sell to the buyer with a package that pre-empts the blocker — which is exactly what the room's disclosure policy and audit record are.

---

## 1. Segment: land where the pain repeats

Target companies that repeatedly need information or access from *other* companies. Frequency is the qualifier — a firm doing this twice a year will never build the habit.

**Beachhead: cloud consultancies and MSPs (25–500 people).**

Why this exact segment first:

- They run the same intake with every client — inventory, architecture, access, constraints — and the intake is the bottleneck, measured in weeks.
- They already have AI agents in production; the wall they hit is client security review, not capability.
- They have a natural reason to invite many counterparties: their own client base. One MSP is 20+ potential rooms.
- Their pain is quantifiable in days-to-first-value, which makes ROI arguments easy.
- They are small enough to buy without a procurement cycle and sophisticated enough to evaluate the security claims honestly.

**Second wave (after the wedge is proven):** cybersecurity assessors and pentest firms, compliance/audit firms (SOC 2 evidence collection is a near-perfect fit for evidence-based completion), software implementation partners, and DevOps consultancies.

**Explicitly not first:** regulated enterprises (long cycles, will demand certifications that don't exist yet), or general "AI agent" buyers (no urgency, no counterparty).

---

## 2. Positioning

**One-liner:** Give an outside company's AI agent exactly the information and authority your task needs — and nothing else.

**Category:** don't invent one. Position inside an existing budget line — *third-party/vendor access* — as the AI-native entry. "Slack Connect for AI agents, with a policy engine and an audit trail" is the fastest way to make it legible; use it in conversation, not on the site.

**Against the alternatives:**

| They do today | Where it breaks | Our line |
|---|---|---|
| Email, spreadsheets, questionnaires | Weeks of latency; sensitive data sprayed across inboxes with no record | Same exchange in hours, with a policy check on every field and one audit trail |
| Shared Slack/Teams channel | No enforcement, no field-level control, no evidence trail | A channel that actually enforces what was agreed |
| Give the vendor a read-only account | Standing access, over-scoped, rarely revoked | Task-scoped and revocable at close |
| Build it internally | Months of work; the hard parts are the policy engine and audit chain | Buy the boundary, keep your own agent |

**What not to claim** — and say so on the site, because in security the honesty *is* the pitch: no end-to-end encryption in hosted mode (policy enforcement requires reading payloads), no certifications yet, no perfect detection, and no control over what a customer's own agent does inside its own environment.

---

## 3. The two-sided motion (the core mechanic)

Every room has an inviter and an invitee. Instrument the invitee side as carefully as the signup funnel.

```
MSP signs up  →  runs a room with one client
        ↓
Client experiences the room as a RECIPIENT (free, no setup burden)
        ↓
Client's security team sees the audit record and the blocked-disclosure log
        ↓
Client becomes a paying org to run rooms with THEIR vendors
        ↓
Those vendors join as recipients …
```

Design decisions that make this work:

- **The invitee side is free, forever, for participation.** You pay to *originate* rooms, not to be invited into one. Charging the invitee kills the loop.
- **The invitation is the marketing asset.** The preview screen — what would be shared, what never is, what needs approval — is the clearest product explanation anyone will read. Treat it as a landing page with a button.
- **Instrument invitee → originator conversion** as the single north-star growth metric.

---

## 4. Beta program design (next 90 days)

Run a **closed, hands-on beta** — the product ships with `BOOTH_SIGNUP_KEY` for exactly this.

- **Target: 8–12 design partners**, each an MSP/consultancy with at least one willing client. Not 100 signups; 10 real rooms.
- **Qualify on the counterparty.** No design partner is admitted without a named client who will join a room in week one. This is the discipline that keeps a two-sided product from dying one-sided.
- **Concierge the first room.** Sit with them, configure the contract, run it live. Every friction point in that hour is a roadmap item.
- **Two commitments in exchange for free access:** a recorded 30-minute debrief, and permission to use anonymized room metrics.
- **Success criteria before opening up:** ≥6 partners run a second room unprompted; ≥2 invitees start their own room; median time-to-first-completed-room under 48 hours; zero security incidents; at least one blocked disclosure that the customer says mattered.

---

## 5. Pricing

Price the **room**, not the seat or the token — it maps to the customer's mental model (a project) and scales with value delivered.

| Tier | Price | Includes | For |
|---|---|---|---|
| **Free** | $0 | Unlimited *participation* as an invitee; 1 originated room; sandbox agent | The viral side of the loop |
| **Team** | $500/mo | 10 active rooms, unlimited participants, all agent types, 1-year audit retention | The MSP beachhead |
| **Business** | $2,000/mo | 50 rooms, SSO/OIDC, custom retention, SIEM export, priority support | Multi-team consultancies |
| **Enterprise** | Custom | Private gateway, customer-managed keys, data residency, DPA/BAA, SLA | The eventual enterprise motion |

Notes on the model:

- Bill on **active** rooms, not created ones — punishing experimentation is fatal in a workflow product.
- Overage per additional room ($75) rather than a hard cap, so a busy month never blocks work.
- Model spend is passed through at cost when we host the agent; most customers will bring their own key, which is also the better security story.
- No per-seat pricing at launch: seats create friction exactly where you want none — inside the customer's team.

---

## 6. Channels, in priority order

1. **Founder-led outbound to a curated list (weeks 1–8).** ~150 named MSPs. The opener is not a demo request — it's a specific claim: *"Your client onboarding intake is 2–3 weeks. Here's a 4-minute recording of that same intake running between two AI agents in 40 minutes, with the credential leak blocked on camera."*
2. **The demo recording as the primary asset.** The blocked-credential moment is the whole pitch in 15 seconds. Everything else is supporting material.
3. **Partner/association channel.** Cloud partner programs and MSP peer groups (MSP-focused communities, vCIO networks) reach dozens of qualified firms per relationship.
4. **Security-credible content, not SEO filler.** Publish the threat model and the security invariants openly. A CISO who reads an honest threat model — including the limits — converts far better than one who reads a claims page. This is a differentiated asset because most AI products won't publish it.
5. **Open-source the protocol edges, not the platform.** The A2A adapter and event schema being public makes integration a non-event for prospects and buys standing in the agent-interop conversation.
6. **Conferences, selectively.** MSP and cloud-partner events where the buyer is in the room; skip generic AI conferences where nobody has a counterparty problem.

---

## 7. The demo that sells

Thirteen beats, four minutes, one recording. Do not vary the order — the emotional arc is: *convenience → alarm → relief → control*.

1. Two companies, two agents, one task.
2. The invitation preview: exactly what will and won't be shared.
3. Agents exchange structured data automatically — this is the "wow, it just works."
4. **The agent tries to send a production credential. It's blocked, on camera.** Stop talking. Let it land.
5. The agent receives the reason and sends a safe alternative instead — the work continues.
6. A production DNS change stops for human approval, with the exact parameters shown.
7. Approve once; the change is released and recorded.
8. Evidence attached, marked *claimed*, then human-verified.
9. Both sides approve completion; the room closes.
10. The audit record: hash chain verified, checkpoints valid.

Then the close: *"Every one of those checks happened outside the model. Nothing an agent said could have changed them."*

---

## 8. Metrics that matter

**Leading (weekly):** invites sent → invites accepted (the loop's health), time-to-first-active-room, rooms per active org.

**Core (monthly):** invitee → originator conversion (the north star), second-room rate, room completion rate, human approval latency.

**Trust (always):** blocked disclosures per room — the number that proves the product did something — and security alerts per room. Both belong in the customer's QBR deck, not just the internal dashboard.

**Do not optimize for:** signups, agent turns, or tokens. All three can go up while value goes down.

---

## 9. Risks, honestly

| Risk | Why it's real | Mitigation |
|---|---|---|
| **Cold-start on the second side** | A room with one participant is worthless | Free invitee tier; qualify design partners on a named counterparty; concierge the first room |
| **"We'll just use a shared channel"** | Cheap and familiar | Lead with the audit record and the blocked disclosure — the two things a channel can never produce |
| **A platform ships this** | Anthropic/Microsoft/Slack could add cross-org agent controls | Move fast on the trust network and reusable policy/contract library — the defensible part is the network and workflow assets, not the protocol |
| **Security incident during beta** | Fatal for a security product | Small closed beta, published threat model, fast disclosure posture, no certification claims |
| **Buyer says "our agents don't do that yet"** | AI maturity varies | The sandbox agent lets them run the whole flow before their agents are ready; land now, expand as they mature |

---

## 10. The first 90 days

**Days 1–30 — Prove it works with strangers.** Ship the closed beta. 10 design partners, each with a named counterparty. Record the demo. Publish the threat model and security invariants. Instrument the invite funnel.

**Days 31–60 — Prove it repeats.** Get to 25 completed rooms. Ship the top three friction fixes from the debriefs (expect: reusable contract templates, email notifications for pending approvals, and a second user per organization). Convert the first invitee into an originator and write that case study.

**Days 61–90 — Prove someone pays.** Convert 3–5 design partners to Team at full price. A free pilot that won't convert at $500/mo is telling you the workflow isn't load-bearing yet — listen to that. Open self-serve signup only once time-to-first-room is under an hour without concierge help.

**The single question to answer in 90 days:** does a company that was *invited* into a room come back and start one of their own? If yes, this compounds. If no, fix the invitee experience before spending a dollar on demand generation.
