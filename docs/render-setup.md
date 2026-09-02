# Deploying to Render, step by step

Start to finish this is about 30 minutes, most of it waiting on builds. At the
end you will have a public URL that a second company can sign into.

You need: a GitHub account, a Render account, and a card on file (the API
cannot run on the free plan — see step 3).

---

## 1. Push the repo to GitHub

```bash
cd telephone_booth
git init
git add .
git commit -m "Secure Agent Rooms"
gh repo create secure-agent-rooms --private --source=. --push
```

Private is fine — you will connect Render to the repo directly.

Check that `.env` did **not** get committed (it is in `.gitignore`, but confirm):

```bash
git ls-files | grep -c '^\.env$'
```

That must print `0`.

## 2. Create the Blueprint

In Render: **New → Blueprint**, pick the repo, and Render reads
`deploy/render.yaml`. If it doesn't find the file, set the blueprint path to
`deploy/render.yaml` explicitly.

It will create three things: `booth-api`, `booth-web`, and a Postgres database
called `booth-postgres`.

## 3. Answer the prompts

Render asks for every value marked `sync: false`. On this first pass you don't
know your URLs yet, so:

| Variable | Now | Later |
|---|---|---|
| `WEB_ORIGIN` | leave blank | step 5 |
| `APP_URL` | leave blank | step 5 |
| `API_BASE_URL` (on `booth-web`) | leave blank | step 5 |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | fill in if you have a mail provider | step 6 |
| `BOOTH_SIGNUP_KEY` | pick a phrase to gate signups, or leave blank | — |

**Do not downgrade the API to the free plan.** Free services spin down when
idle, and the API's background runtime is what advances agent turns and
delivers notifications — a sleeping API means rooms silently stop progressing.
`starter` stays running. The web service *can* be free if you don't mind a cold
start on the marketing page.

Click **Apply**. The first build takes a few minutes.

## 4. Watch the first boot

Open `booth-api` → Logs. A healthy boot looks like:

```
[booth] applied migrations: 0001_init.sql, 0002_notifications.sql
Secure Agent Rooms API listening on http://0.0.0.0:10000 (env=production)
```

The API runs its own migrations before accepting traffic, so there is no
separate migration step.

If it exits instead, the message says exactly what is wrong. The two you might
actually hit:

- `BOOTH_AUDIT_KEY must be at least 32 bytes` — Render's generated value was
  too short. Replace it: `openssl rand -base64 48`, paste it in, redeploy.
- `DATABASE_URL is required in production` — the database wasn't linked. Check
  that `booth-postgres` was created and the `fromDatabase` reference resolved.

Both are the system refusing to run insecurely rather than starting up broken.

## 5. Point the two services at each other

Render has now assigned URLs, something like:

- API: `https://booth-api.onrender.com`
- Web: `https://booth-web.onrender.com`

Set them:

**On `booth-api`** → Environment:
- `WEB_ORIGIN` = the **web** URL (this is the CORS allowlist)
- `APP_URL` = the **web** URL (used for links in emails)

**On `booth-web`** → Environment:
- `API_BASE_URL` = the **API** URL

Save. Render restarts both. **A restart is enough** — the browser fetches the
API URL from `/config.js` at runtime rather than having it compiled into the
bundle, so you do not need to rebuild.

Verify:

```bash
curl https://booth-api.onrender.com/readyz
# {"ok":true,"storage":"postgres"}

curl https://booth-web.onrender.com/config.js
# window.__BOOTH__={"apiBase":"https://booth-api.onrender.com"};
```

If the second one still says `localhost`, the env var didn't take — check it is
on `booth-web` and not `booth-api`.

## 6. Turn on email (recommended)

Approvals block the work, so people need telling. Any SMTP provider works —
Resend, Postmark, SES, Mailgun. On `booth-api` set:

- `SMTP_HOST`, `SMTP_PORT` (587 for STARTTLS, 465 for implicit TLS)
- `SMTP_USER`, `SMTP_PASS`
- `EMAIL_FROM`, e.g. `Secure Agent Rooms <no-reply@yourdomain.com>`

**Configure SPF and DKIM on that domain.** Transactional mail from an
unauthenticated domain goes to spam, and an invitation in spam is an invitation
that never happened.

Without `SMTP_HOST` the product works normally and simply doesn't email —
approvals still appear as a badge in the app.

## 7. Prove it end to end

Sign up at `https://booth-web.onrender.com`. Then, as a real test of the thing
that matters — that a *second company* can join:

1. Start a room, pick **Cloud migration**, and enter a second email address you
   control as the counterpart.
2. Open that invitation in a different browser (or a private window), sign up,
   and click **Accept and set up**.
3. Back on the first account, press **Start room**. Within a few seconds the
   agents exchange a data request and response by themselves.
4. In the room, send this as a message to watch enforcement work:
   `postgres://admin:hunter2@db.internal:5432/prod` — it is blocked, and the
   block explains itself.

That fourth step is the demo. If it blocks, everything underneath it is working.

## What it costs

Two `starter` services plus a `basic-256mb` Postgres. Check Render's current
pricing — it was roughly $7/service/month plus the database when this was
written, so on the order of $20/month for the beta. The database is the piece
worth sizing up first.

## Custom domain

Render → service → Settings → Custom Domains. Add `app.yourdomain.com` to the
web service and `api.yourdomain.com` to the API, create the CNAMEs Render shows
you, and wait for the certificates. Then update the three URL variables from
step 5 to the new domains and restart. Same rule: restart, not rebuild.

## Known limits of this deployment

- **One API instance.** Scaling out needs Redis for rate limiting and
  idempotency, and a durable room-claim lock, or two orchestrators will each
  spend the same room's budget. The blueprint pins `numInstances: 1`.
- **No OIDC.** Sign-in is password-based (scrypt). Enterprise SSO sits behind
  the same session abstraction when you need it.
- **Back up Postgres.** The audit chain lives there, and it is the record you
  would hand an auditor. Render's automatic backups depend on the plan.
- **Untested blueprint.** This file is written and validated but has not been
  run against Render. Expect one or two small corrections on the first deploy —
  the log messages are written to tell you exactly what to fix.
