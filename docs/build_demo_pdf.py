#!/usr/bin/env python3
"""
Builds the Secure Agent Rooms product walkthrough PDF from real screenshots.

Run after capturing screenshots into docs/demo-assets/:
    python3 docs/build_demo_pdf.py
"""
from pathlib import Path

from PIL import Image
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image as RLImage,
    KeepTogether,
    ListFlowable,
    ListItem,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "docs" / "demo-assets"
OUT = ROOT / "docs" / "Secure-Agent-Rooms-Walkthrough.pdf"

# Palette mirrors the product's own vocabulary: pass / hold / stop.
INK = colors.HexColor("#0E1A20")
PAPER = colors.HexColor("#FFFFFF")
STEEL = colors.HexColor("#5C7480")
RULE = colors.HexColor("#D3DBD7")
PASS = colors.HexColor("#2F6B52")
HOLD = colors.HexColor("#A8781F")
STOP = colors.HexColor("#B4472C")
TINT = colors.HexColor("#F2F4F1")

PAGE_W, PAGE_H = letter
MARGIN = 0.75 * inch
CONTENT_W = PAGE_W - 2 * MARGIN

styles = getSampleStyleSheet()


def style(name, **kw):
    base = kw.pop("parent", styles["BodyText"])
    return ParagraphStyle(name, parent=base, **kw)


S = {
    "title": style("title", parent=styles["Title"], fontName="Helvetica-Bold",
                   fontSize=30, leading=34, textColor=INK, alignment=TA_LEFT, spaceAfter=10),
    "subtitle": style("subtitle", fontName="Helvetica", fontSize=13.5, leading=19,
                      textColor=STEEL, spaceAfter=18),
    "h1": style("h1", fontName="Helvetica-Bold", fontSize=19, leading=23,
                textColor=INK, spaceBefore=4, spaceAfter=8),
    "h2": style("h2", fontName="Helvetica-Bold", fontSize=13.5, leading=17,
                textColor=INK, spaceBefore=12, spaceAfter=5),
    "body": style("body", fontName="Helvetica", fontSize=10.2, leading=15.2,
                  textColor=INK, spaceAfter=7),
    "muted": style("muted", fontName="Helvetica", fontSize=9.2, leading=13.2,
                   textColor=STEEL, spaceAfter=6),
    "caption": style("caption", fontName="Helvetica-Oblique", fontSize=8.6, leading=11.6,
                     textColor=STEEL, spaceBefore=5, spaceAfter=14),
    "step": style("step", fontName="Helvetica-Bold", fontSize=9, leading=12,
                  textColor=PASS, spaceAfter=3),
    "mono": style("mono", fontName="Courier", fontSize=8.4, leading=11.6, textColor=INK),
    "cell": style("cell", fontName="Helvetica", fontSize=9, leading=12.4, textColor=INK),
    "cellhead": style("cellhead", fontName="Helvetica-Bold", fontSize=8.4, leading=11,
                      textColor=STEEL),
    "quote": style("quote", fontName="Helvetica-Oblique", fontSize=10.6, leading=15,
                   textColor=INK, leftIndent=12, spaceAfter=8),
}


def on_page(canvas, doc):
    canvas.saveState()
    # Header rule + running title
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.6)
    canvas.line(MARGIN, PAGE_H - MARGIN + 16, PAGE_W - MARGIN, PAGE_H - MARGIN + 16)
    canvas.setFont("Helvetica", 7.6)
    canvas.setFillColor(STEEL)
    canvas.drawString(MARGIN, PAGE_H - MARGIN + 22, "SECURE AGENT ROOMS  ·  PRODUCT WALKTHROUGH")
    # Footer
    canvas.line(MARGIN, MARGIN - 14, PAGE_W - MARGIN, MARGIN - 14)
    canvas.drawString(MARGIN, MARGIN - 25, "Secure cross-company AI collaboration")
    canvas.drawRightString(PAGE_W - MARGIN, MARGIN - 25, f"{doc.page}")
    canvas.restoreState()


def on_cover(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(INK)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    # Boundary seam with three seals — the product's own device.
    seam_x = PAGE_W / 2
    canvas.setStrokeColor(colors.HexColor("#22343C"))
    canvas.setLineWidth(1)
    canvas.setDash(3, 4)
    canvas.line(seam_x, MARGIN, seam_x, PAGE_H - MARGIN)
    canvas.setDash()
    for i, c in enumerate((PASS, HOLD, STOP)):
        y = PAGE_H / 2 - 96 - i * 44
        canvas.setFillColor(c)
        canvas.rect(seam_x - 9, y, 18, 18, fill=1, stroke=0)
    canvas.restoreState()


def img(name, caption=None, max_h=6.1 * inch):
    """Place a screenshot scaled to the content width, capped in height."""
    path = ASSETS / name
    with Image.open(path) as im:
        w, h = im.size
    scale = min(CONTENT_W / w, (max_h * inch / inch) / h if h else 1)
    scale = min(CONTENT_W / w, max_h / h)
    pic = RLImage(str(path), width=w * scale, height=h * scale)
    pic.hAlign = "LEFT"
    items = [pic]
    if caption:
        items.append(Paragraph(caption, S["caption"]))
    return items


def table(rows, widths, header=True):
    data = []
    for i, row in enumerate(rows):
        st = S["cellhead"] if (header and i == 0) else S["cell"]
        data.append([Paragraph(c, st) for c in row])
    t = Table(data, colWidths=widths, hAlign="LEFT")
    cmds = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ]
    if header:
        cmds.append(("LINEBELOW", (0, 0), (-1, 0), 0.9, STEEL))
    t.setStyle(TableStyle(cmds))
    return t


def callout(text, accent=PASS, bg=TINT):
    p = Paragraph(text, S["body"])
    t = Table([[p]], colWidths=[CONTENT_W], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LINEBEFORE", (0, 0), (0, -1), 2.5, accent),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
    ]))
    return t


def bullets(items, color=INK):
    return ListFlowable(
        [ListItem(Paragraph(i, S["body"]), leftIndent=14) for i in items],
        bulletType="bullet", start="•", leftIndent=14, bulletFontSize=8,
        bulletColor=color, spaceAfter=8,
    )


def step_header(n, title, subtitle=None):
    out = [Paragraph(f"STEP {n}", S["step"]), Paragraph(title, S["h1"])]
    if subtitle:
        out.append(Paragraph(subtitle, S["muted"]))
    return out


story = []

# ---------------------------------------------------------------- cover
story += [
    Spacer(1, 2.5 * inch),
    Paragraph('<font color="#FFFFFF">Secure Agent Rooms</font>',
              style("cov", parent=S["title"], fontSize=38, leading=42)),
    Paragraph('<font color="#93A7B0">A complete product walkthrough — from signing up to a '
              'verified audit record, with every screen captured from the running system.</font>',
              style("covsub", parent=S["subtitle"], fontSize=13, leading=19)),
    Spacer(1, 0.5 * inch),
    Paragraph('<font color="#57A883">PASSED</font>  ·  <font color="#D6A545">NEEDS A HUMAN</font>'
              '  ·  <font color="#E0725A">BLOCKED</font>',
              style("covseal", parent=S["muted"], fontSize=10.5, textColor=colors.white)),
    NextPageTemplate("body"),
    PageBreak(),
]

# ---------------------------------------------------------------- what/why
story += [
    Paragraph("What this is", S["h1"]),
    Paragraph(
        "A Secure Agent Room is a temporary, task-scoped boundary between two companies. Each side "
        "connects its own AI agent — Claude, GPT, Gemini, Copilot, an A2A-native agent, or the built-in "
        "sandbox agent — and both sides agree in advance on exactly what may be exchanged and which "
        "actions require a human.", S["body"]),
    Paragraph(
        "Everything an agent produces is checked before it crosses the boundary. Credentials never cross "
        "at all — not by policy you could misconfigure, and not even with a human approval.", S["body"]),
    Spacer(1, 6),
    callout(
        "<b>The problem it solves.</b> Two companies want their AI agents to work together. Today that "
        "means questionnaires, spreadsheets, shared channels, or handing over a read-only account — all "
        "of which are slow, over-scoped, and leave no usable record. The alternative has been to not use "
        "agents across the boundary at all."),
    Spacer(1, 14),
    Paragraph("The walkthrough that follows", S["h2"]),
    Paragraph(
        "Two fictional companies run a real task end to end: <b>Northwind Freight</b> (the customer) needs "
        "its Phoenix application migrated to Azure, and <b>Meridian Cloud</b> (the provider) will plan and "
        "execute it. Every screenshot is from the running system — including the moment a credential "
        "disclosure is blocked and the moment a production DNS change stops for a human.", S["body"]),
    Spacer(1, 8),
    table([
        ["#", "Step", "What it demonstrates"],
        ["1", "Sign in", "Account creation and the honest security posture"],
        ["2", "Connect an agent", "Vendor-neutral agents; credentials stay with the customer"],
        ["3", "Author the task contract", "Scope, checklist, data classes, action permissions"],
        ["4", "Set the disclosure policy", "Per-class allow / ask / never, deny by default"],
        ["5", "Invite the other company", "The recipient sees exactly what they're agreeing to"],
        ["6", "Start the room", "Agents collaborate automatically, server-side"],
        ["7", "A credential is blocked", "Deterministic enforcement outside the model"],
        ["8", "An action needs a human", "Approval bound to exact parameters, single-use"],
        ["9", "Evidence and completion", "Claims are not facts until a human verifies"],
        ["10", "The audit record", "Hash-chained, signed, verifiable"],
    ], [0.35 * inch, 1.7 * inch, CONTENT_W - 2.05 * inch]),
    PageBreak(),
]

# ---------------------------------------------------------------- landing
story += [
    Paragraph("Before the walkthrough: the product's promise", S["h1"]),
    Paragraph(
        "The landing page states the mechanism rather than a slogan: three payloads attempt to cross the "
        "boundary, and each is stamped with what actually happened to it.", S["body"]),
] + img("shot-landing.png",
        "The public landing page. The panel on the right is the product's own vocabulary — a structured "
        "data response passes, a production DNS change is held for a human, and a connection string "
        "containing a password is blocked outright.") + [
    PageBreak(),
]

# ---------------------------------------------------------------- step 1
story += step_header(0, "Getting started takes two forms and a click",
                     "Signing up provisions a working sandbox agent, so a room can be created, configured "
                     "and sent in a single screen.")
story += img("shot-launch.png",
             "Starting a room. Choosing a template shows exactly what it permits, forbids, and gates before "
             "you commit; the form then writes the contract, sets your policy, connects your agent, records "
             "your approval, and emails the invitation.", max_h=6.9 * inch)
story += [PageBreak()]

story += [
    Paragraph("The invited side is one click", S["h1"]),
    Paragraph(
        "Your counterpart reviews the terms — what their agent may share, what is never exchanged, what "
        "stops for their approval — and accepts. That single action joins them, sets a disclosure policy "
        "derived from the agreed contract, connects their agent, and records their approval of that exact "
        "contract version. The room is then ready to start.", S["body"]),
] + img("shot-accept.png",
        "Accepting is informed, not blind: the terms are stated, and the panel says plainly what accepting "
        "will configure on their behalf.", max_h=5.4 * inch)
story += [PageBreak()]

story += [
    Paragraph("Nobody has to be watching for an approval", S["h1"]),
    Paragraph(
        "An approval that goes unseen blocks the work, so the people who can decide are emailed — with a "
        "reminder four hours later if it is still undecided, and a badge in the app meanwhile.", S["body"]),
] + img("shot-approval-email.png",
        "The approval notification. It names the action and the risk and links to the room — and says "
        "explicitly that it does not include the proposed parameters.", max_h=5.4 * inch) + [
    callout(
        "<b>Email is outside the trust boundary.</b> Mail is forwarded, archived and indexed, so "
        "notifications never carry the proposed parameters, the disclosed data, or the blocked content. "
        "They carry what needs attention and a link; you sign in to see the rest.", accent=HOLD),
    PageBreak(),
]

story += step_header(1, "Sign in",
                     "Password authentication with scrypt hashing; an external OIDC provider can front "
                     "this for enterprise deployments.")
story += img("shot-login.png",
             "Registration creates an organization and makes you its owner. Deployments running a closed "
             "beta can require a signup key. In production, passwordless dev sign-in cannot be enabled at "
             "all — the server refuses to start with it on.")
story += [
    callout("<b>Fail-closed by design.</b> A production instance refuses to start without a durable "
            "database or an audit signing key, rather than silently running on memory that a restart "
            "would erase, or signing the audit trail with a publicly known key.",
            accent=HOLD),
    PageBreak(),
]

# ---------------------------------------------------------------- step 2
story += step_header(2, "Connect an agent",
                     "Each company connects its own agent, on its own side. Neither company ever calls "
                     "the other's agent, tools, or data directly.")
story += img("shot-agents.png",
             "Four connection types. The sandbox agent needs no credentials at all, which is how a team "
             "can trial the entire product before wiring up an LLM.", max_h=5.4 * inch)
story += [
    Paragraph("What the platform stores", S["h2"]),
    Paragraph(
        "Only a <i>reference</i> to where your secret lives — for example <font face='Courier'>"
        "env:ANTHROPIC_API_KEY</font>. The key itself is resolved in memory at call time and never enters "
        "the database, a prompt, a room event, or a log. The API strips the reference from every response "
        "it returns.", S["body"]),
    PageBreak(),
]

# ---------------------------------------------------------------- step 3+4
story += step_header(3, "Author the task contract, and set your policy",
                     "The contract is what both companies agree to. The policy is what your side will "
                     "disclose. They are separate on purpose.")
story += img("shot-setup.png",
             "Left: the task contract — objective, completion checklist, which classes of information are "
             "in scope, and whether each action is disallowed, autonomous, or requires a human. Right: "
             "your own disclosure policy, per class, with anything unset denied by default. Credentials, "
             "private keys, API keys and auth tokens appear as permanently blocked and cannot be enabled.",
             max_h=7.2 * inch)
story += [PageBreak()]

story += [
    Paragraph("Why these are two different things", S["h2"]),
    Paragraph(
        "The <b>contract</b> is bilateral: both companies approve the identical version, and any change "
        "re-opens approval on both sides — permissions never expand silently. The <b>policy</b> is "
        "unilateral: it is your organization's own rule about what your agent may reveal, and the other "
        "company never sets it for you.", S["body"]),
    Spacer(1, 6),
    table([
        ["Setting", "Effect"],
        ["Allow", "Your agent may disclose this class automatically."],
        ["Ask me", "Each disclosure of this class stops for a human on your side."],
        ["Never", "Blocked entirely."],
        ["(unset)", "Denied — the engine is deny-by-default."],
        ["Disclosure ceiling", "Anything classified above this level requires approval regardless of class."],
    ], [1.5 * inch, CONTENT_W - 1.5 * inch]),
    Spacer(1, 12),
    callout(
        "<b>The order of checks.</b> Platform floors first (secrets and credential classes are refused "
        "unconditionally), then the task contract, then your own policy. A permissive policy cannot "
        "override the floor, and neither can a human approval."),
    PageBreak(),
]

# ---------------------------------------------------------------- step 5
story += step_header(5, "Invite the other company",
                     "The invitation is the clearest explanation of the product anyone will read: it "
                     "states what will be shared before anything is.")
story += img("shot-invite.png",
             "What the recipient sees before joining. The invite link alone grants no access to room "
             "content — it must be redeemed by an authenticated user, it expires, and it works once.",
             max_h=5.2 * inch)
story += [
    Paragraph("Properties of the invitation", S["h2"]),
    bullets([
        "256 bits of randomness; only its SHA-256 hash is stored, so the raw token exists once, in the link.",
        "Single redemption, with an expiry, and revocable at any time.",
        "Optionally bound to a specific email address or company domain.",
        "Possession is not authorization — the recipient must sign in, and joining requires admin rights "
        "in their own organization.",
    ]),
    PageBreak(),
]

# ---------------------------------------------------------------- step 6/7/8
story += step_header(6, "The room runs",
                     "Once both sides approve the contract and connect an agent, a human starts the room "
                     "and the agents begin taking turns automatically.")
story += img("shot-room-active.png",
             "The live room. Both organizations' readiness is visible at a glance; a high-risk action is "
             "waiting for a human; the conversation, checklist, evidence, and security timeline are all "
             "on one screen.", max_h=6.6 * inch)
story += [PageBreak()]

story += step_header(7, "A credential is blocked — on camera",
                     "The provider's agent attempts to send a production connection string. This is the "
                     "moment the product exists for.")
story += img("shot-blocked.png",
             "The block is explained rather than hidden: what was blocked, which rule fired "
             "(platform.secret_disclosure), and what the agent was told. Note the next message — the agent "
             "received the guidance and sent non-secret metadata instead, so the work continued.",
             max_h=6.3 * inch)
story += [
    callout(
        "<b>Nothing the agent said could have changed this.</b> The check runs outside the model, on a "
        "deterministic engine. A prompt-injected, compromised, or simply mistaken agent produces the same "
        "outcome — and the blocked content itself is never sent or stored.", accent=STOP),
    PageBreak(),
]

story += step_header(8, "A production change stops for a human",
                     "The provider proposes a DNS cutover. The task contract marks that as "
                     "approval-required, so it is held rather than delivered.")
story += [
    Paragraph("The approval shows the exact parameters — the record, the current value, and the proposed "
              "value — not a generic \"allow this agent to proceed\" prompt.", S["body"]),
    Spacer(1, 4),
    table([
        ["Property", "Guarantee"],
        ["Bound to parameters", "Approval binds to a hash of the exact payload. Change any parameter and "
                                "the approval is invalidated; a new one is required."],
        ["Single use", "Consumed atomically. Concurrent double-approval releases the action exactly once."],
        ["Correctly scoped", "Only admins of the <i>acting</i> organization can approve their own agent's action."],
        ["Still subject to the floor", "The approved payload is re-scanned on release. An approval can "
                                       "never release secret material."],
        ["Expiring", "Unapproved requests expire; closing the room invalidates all outstanding approvals."],
    ], [1.5 * inch, CONTENT_W - 1.5 * inch]),
    Spacer(1, 10),
    callout("<b>What a human sees, not what a system logs.</b> \"Approve once\" and \"Reject\" — never a "
            "vague \"continue\" — with the payload visible above the buttons.", accent=HOLD),
    PageBreak(),
]

# ---------------------------------------------------------------- step 9/10
story += step_header(9, "Evidence, then dual completion",
                     "Finishing is not something an agent can declare.")
story += [
    Paragraph(
        "Each checklist item requires evidence — a resource identifier, a tool readback, a test result, a "
        "document. When an agent submits evidence it is recorded as <b>CLAIMED</b>. It stays that way "
        "until a person marks it verified, and the room cannot complete on claimed evidence alone.",
        S["body"]),
    Spacer(1, 4),
    table([
        ["State", "Meaning"],
        ["CLAIMED", "An agent asserted it. Not yet checked by anyone."],
        ["ATTESTED", "A participant formally attests to it."],
        ["SYSTEM_VERIFIED", "Confirmed by a system readback rather than a claim."],
        ["HUMAN_VERIFIED", "A named person checked it. Required for completion."],
    ], [1.5 * inch, CONTENT_W - 1.5 * inch]),
    Spacer(1, 10),
    Paragraph(
        "Both organizations must then approve completion independently. Closing the room stops agent "
        "execution, invalidates outstanding approvals, revokes unredeemed invitations, and writes a signed "
        "checkpoint over the audit chain.", S["body"]),
    PageBreak(),
]

story += step_header(10, "The audit record",
                     "Every consequential operation, hash-chained so that silent edits are detectable.")
story += img("shot-audit.png",
             "Each event's hash covers the previous event's hash, so removing, reordering, or editing any "
             "entry breaks the chain. Periodic checkpoints are signed with a key the application never "
             "exposes. The banner is a live verification, not a badge.", max_h=5.6 * inch)
story += [
    Paragraph(
        "This is the artifact you hand an auditor: who did what, when, under which policy version, with "
        "which decision — including every disclosure that was blocked and every approval a human granted.",
        S["body"]),
    PageBreak(),
]

# ---------------------------------------------------------------- vendor neutrality
story += [
    Paragraph("Working with whatever agent each company already uses", S["h1"]),
    Paragraph(
        "Vendor neutrality is a requirement, not a feature: the two companies in a room will rarely have "
        "made the same model choice. Every agent type is reached through one adapter interface, and the "
        "enforcement pipeline is identical regardless of which one is on either side.", S["body"]),
    Spacer(1, 6),
    table([
        ["Agent", "How it connects", "Notes"],
        ["Sandbox agent", "Built in", "No credentials. Runs the full flow for trials and demos."],
        ["Claude", "Anthropic API", "Model selectable per connection."],
        ["OpenAI / Azure OpenAI /<br/>Gemini / local models",
         "OpenAI-compatible API",
         "One adapter serves any provider speaking Chat Completions; set the base URL."],
        ["Your own agent", "A2A endpoint",
         "The agent card's hash is pinned. If its endpoint, skills, or security configuration change, the "
         "connection is disabled until a human re-approves it."],
    ], [1.35 * inch, 1.5 * inch, CONTENT_W - 2.85 * inch]),
    Spacer(1, 12),
    callout(
        "<b>Why the card hash is pinned.</b> An agent you approved on Monday could advertise new "
        "capabilities on Friday. Pinning turns that into a re-approval instead of a silent expansion of "
        "what the other side's agent can do."),
    PageBreak(),
]

# ---------------------------------------------------------------- the pipeline
story += [
    Paragraph("What happens to every message an agent writes", S["h1"]),
    Paragraph(
        "There is exactly one path into a room's event stream, and it runs six checks in order. The model "
        "never decides whether its own output is safe to send.", S["body"]),
    Spacer(1, 8),
]
for n, t, b in [
    ("01", "Schema validation",
     "Output must match a typed event. Malformed output is dropped, never coerced into something usable."),
    ("02", "Structural field filtering",
     "A data response may carry only the exact fields the peer requested. Everything else is stripped "
     "before it leaves — this is the strongest of the six, because it never depends on detection."),
    ("03", "Secret and PII detection",
     "Layered detectors scan every value, and also reassemble values split across sibling fields so that "
     "chunking a credential across two fields does not evade the scan."),
    ("04", "Policy decision",
     "A deny-by-default engine evaluates platform floors, then the task contract, then the sending "
     "organization's own policy. Deterministic, and outside the model."),
    ("05", "Human gate",
     "Anything marked approval-required is held with its exact parameters until a person decides."),
    ("06", "Persist, route, and record",
     "Only then is the event given a server-assigned sequence, delivered to the peer, and written to the "
     "hash-chained audit log."),
]:
    story.append(KeepTogether([
        Paragraph(f'<font color="#5C7480" face="Courier">{n}</font>&nbsp;&nbsp;<b>{t}</b>', S["body"]),
        Paragraph(b, S["muted"]),
    ]))
story += [
    Spacer(1, 10),
    callout(
        "<b>Trusted fields are server-assigned.</b> Sequence numbers, sender identity, classification, and "
        "the policy decision are written by the platform. An agent cannot set them, so it cannot forge who "
        "said something, or claim its own message was already approved."),
    PageBreak(),
]

# ---------------------------------------------------------------- honest limits
story += [
    Paragraph("What this does not do", S["h1"]),
    Paragraph(
        "A security product that oversells is worse than one that under-promises. These limits are stated "
        "in the product itself, not just in this document.", S["body"]),
    Spacer(1, 6),
    callout(
        "<b>We govern the boundary between companies, not your own environment.</b> If your agent runs on "
        "your own machines with your own standing credentials, it can act there without us. Run it in "
        "hosted mode, where its only capabilities are the ones you connect — or issue it scoped, "
        "short-lived credentials only after an approval.", accent=STOP),
    Spacer(1, 8),
    bullets([
        "<b>No detector is perfect.</b> Field-level scoping is the real defense; secret and PII scanning "
        "is a deliberately cautious second layer, not a guarantee.",
        "<b>Hosted mode is not end-to-end encrypted.</b> Enforcing policy requires reading the payload. "
        "The roadmap answer is a private gateway that enforces inside your own network and forwards only "
        "approved payloads.",
        "<b>No certifications yet.</b> The system is built toward SOC 2 and GDPR practices — access "
        "logging, encryption, change tracking, environment separation — but no audit has been performed.",
        "<b>Evidence is only as good as its verification.</b> That is precisely why agent claims stay "
        "marked unverified until a person checks them.",
    ]),
    PageBreak(),
]

# ---------------------------------------------------------------- getting started
story += [
    Paragraph("Getting started", S["h1"]),
    Paragraph(
        "The fastest honest evaluation is to run the whole flow with the sandbox agent — no API keys, no "
        "model spend — and watch the blocked disclosure and the approval gate happen for real.", S["body"]),
    Spacer(1, 6),
    Paragraph("Self-host in about five minutes", S["h2"]),
    Paragraph(
        '<font face="Courier">cp .env.example .env</font><br/>'
        '<font face="Courier"># set BOOTH_AUDIT_KEY to 32+ random bytes</font><br/>'
        '<font face="Courier">docker compose up --build</font>', S["mono"]),
    Spacer(1, 10),
    Paragraph(
        "That brings up Postgres, the API, and the web application, and runs database migrations before "
        "the API starts. Blueprints for one-click cloud deployment are included for Render and Fly.io, and "
        "the images are plain Dockerfiles that run on any container host.", S["body"]),
    Spacer(1, 8),
    Paragraph("Then, in the product", S["h2"]),
    Paragraph(
        "Create your organization, connect the sandbox agent, create a room, fill in the contract and your "
        "policy, generate an invite, and send it to a colleague using a second account as the other "
        "company. The whole loop takes a few minutes and exercises every control in this document.",
        S["body"]),
    Spacer(1, 14),
] + img("shot-docs.png",
        "The documentation covers the quickstart, core concepts, connecting each agent type, the policy "
        "model, the API, self-hosting, and the security model.", max_h=4.3 * inch)

story += [
    Spacer(1, 10),
    callout(
        "<b>The promise, restated.</b> Two companies can let their AI agents do real work together without "
        "either one exposing its credentials, its internal systems, its unrestricted context, or its "
        "authority to the other."),
]

doc = BaseDocTemplate(
    str(OUT), pagesize=letter,
    leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=MARGIN,
    title="Secure Agent Rooms — Product Walkthrough",
    author="Secure Agent Rooms",
    subject="A complete walkthrough of secure cross-company AI agent collaboration",
)
frame = Frame(MARGIN, MARGIN, CONTENT_W, PAGE_H - 2 * MARGIN, id="f")
doc.addPageTemplates([
    PageTemplate(id="cover", frames=[frame], onPage=on_cover),
    PageTemplate(id="body", frames=[frame], onPage=on_page),
])
doc.build(story)
print(f"wrote {OUT}")
