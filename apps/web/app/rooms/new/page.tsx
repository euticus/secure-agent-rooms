"use client";

import { useEffect, useState } from "react";
import { api, getToken } from "@/lib/api";

interface Org { id: string; name: string; role: string }
interface Template {
  id: string;
  name: string;
  summary: string;
  audience: string;
  objective: string;
  permittedDataClasses: string[];
  forbiddenDataClasses: string[];
  approvalRequiredActions: string[];
  completionCriteria: string[];
}
interface LaunchResult {
  room: { id: string; name: string; state: string };
  inviteToken: string;
  inviteUrl: string;
  invitationEmailed: boolean;
  remaining: string[];
}

/**
 * One screen from "I have an account" to "the other company has been invited
 * to a fully configured room". Everything here is editable afterwards.
 */
export default function NewRoomPage() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("cloud_migration");
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [counterpartEmail, setCounterpartEmail] = useState("");
  const [personalNote, setPersonalNote] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const template = templates.find((t) => t.id === templateId);

  useEffect(() => {
    if (!getToken()) {
      window.location.href = "/login";
      return;
    }
    api<{ organizations: Org[] }>("/v1/me").then((me) => {
      setOrgs(me.organizations);
      if (me.organizations[0]) setOrgId(me.organizations[0].id);
    });
    api<Template[]>("/v1/templates").then(setTemplates).catch(() => {});
    api<{ emailEnabled: boolean }>("/v1/notifications/settings")
      .then((s) => setEmailEnabled(s.emailEnabled))
      .catch(() => {});
  }, []);

  // Prefill the objective from the chosen template unless the user edited it.
  const [objectiveTouched, setObjectiveTouched] = useState(false);
  useEffect(() => {
    if (!objectiveTouched && template) setObjective(template.objective);
  }, [templateId, template, objectiveTouched]);

  async function launch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<LaunchResult>("/v1/rooms/launch", {
        method: "POST",
        body: {
          organizationId: orgId,
          templateId,
          name,
          objective: objective || undefined,
          counterpartEmail: counterpartEmail || undefined,
          personalNote: personalNote || undefined,
        },
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not create the room");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const link = `${window.location.origin}${result.inviteUrl}`;
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <div>
          <h1 className="text-xl font-semibold">Room created and configured</h1>
          <p className="mt-1 text-sm text-slate-400">
            {result.invitationEmailed
              ? `We emailed the invitation to ${counterpartEmail}. Once they accept, the room is ready to start.`
              : "Send this link to the other company. Once they accept, the room is ready to start."}
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="mb-2 text-sm font-medium">Invitation link</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 rounded bg-slate-800 px-3 py-2 font-mono text-xs"
            />
            <button
              onClick={() => {
                navigator.clipboard?.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="rounded bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            The link expires, works once, and grants no access to room content on its own.
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <p className="mb-2 text-sm font-medium">What happens next</p>
          <ol className="ml-4 list-decimal space-y-1 text-sm text-slate-400">
            {result.remaining.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ol>
        </div>

        <div className="flex gap-2">
          <a href={`/rooms/${result.room.id}`} className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium">
            Open the room
          </a>
          <a href="/dashboard" className="rounded bg-slate-800 px-4 py-2 text-sm">
            Back to dashboard
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Start a room</h1>
        <p className="mt-1 text-sm text-slate-400">
          Pick a starting point, name the task, and tell us who to invite. We&apos;ll set up the contract,
          your disclosure policy, and your agent — all editable afterwards.
        </p>
      </div>

      <form onSubmit={launch} className="space-y-5">
        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="mb-1 text-sm font-semibold">1. What kind of work is this?</h2>
          <p className="mb-3 text-xs text-slate-400">
            Each option comes with a task contract and a matching disclosure policy.
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            {templates.map((t) => (
              <label
                key={t.id}
                className={`cursor-pointer rounded border p-3 ${
                  templateId === t.id ? "border-emerald-600 bg-emerald-950/20" : "border-slate-800"
                }`}
              >
                <input
                  type="radio"
                  name="template"
                  className="sr-only"
                  checked={templateId === t.id}
                  onChange={() => setTemplateId(t.id)}
                />
                <span className="block text-sm font-medium">{t.name}</span>
                <span className="mt-1 block text-xs text-slate-400">{t.summary}</span>
              </label>
            ))}
          </div>
          {template && template.id !== "blank" && (
            <div className="mt-3 grid gap-3 rounded border border-slate-800 bg-slate-950/40 p-3 text-xs md:grid-cols-3">
              <div>
                <p className="mb-1 font-medium text-emerald-400">May be exchanged</p>
                <ul className="space-y-0.5 text-slate-400">
                  {template.permittedDataClasses.map((c) => (
                    <li key={c}>{c.replaceAll("_", " ")}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1 font-medium text-red-400">Never exchanged</p>
                <ul className="space-y-0.5 text-slate-400">
                  {template.forbiddenDataClasses.map((c) => (
                    <li key={c}>{c.replaceAll("_", " ")}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1 font-medium text-amber-400">Needs your approval</p>
                <ul className="space-y-0.5 text-slate-400">
                  {template.approvalRequiredActions.map((c) => (
                    <li key={c}>{c.replaceAll("_", " ")}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold">2. Name the task</h2>
          <label className="block text-sm">
            <span className="text-slate-300">Room name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Migrate Project Phoenix to Azure"
              className="mt-1 w-full rounded bg-slate-800 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-300">What should the agents accomplish?</span>
            <textarea
              value={objective}
              onChange={(e) => {
                setObjective(e.target.value);
                setObjectiveTouched(true);
              }}
              rows={2}
              className="mt-1 w-full rounded bg-slate-800 px-3 py-2"
            />
          </label>
          {orgs.length > 1 && (
            <label className="block text-sm">
              <span className="text-slate-300">Your organization</span>
              <select
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                className="mt-1 w-full rounded bg-slate-800 px-3 py-2"
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
          )}
        </section>

        <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-sm font-semibold">3. Who are you working with?</h2>
          <label className="block text-sm">
            <span className="text-slate-300">Their work email {emailEnabled ? "" : "(optional)"}</span>
            <input
              type="email"
              value={counterpartEmail}
              onChange={(e) => setCounterpartEmail(e.target.value)}
              placeholder="name@theircompany.com"
              className="mt-1 w-full rounded bg-slate-800 px-3 py-2"
            />
            <span className="mt-1 block text-xs text-slate-400">
              {emailEnabled
                ? "We'll email them the invitation. They see exactly what would be exchanged before agreeing to anything."
                : "Email delivery is not configured on this deployment, so you'll get a link to send yourself."}
            </span>
          </label>
          <label className="block text-sm">
            <span className="text-slate-300">Add a note (optional)</span>
            <input
              value={personalNote}
              onChange={(e) => setPersonalNote(e.target.value)}
              placeholder="Context for your counterpart"
              className="mt-1 w-full rounded bg-slate-800 px-3 py-2"
            />
          </label>
        </section>

        {error && <p className="rounded border border-red-800 bg-red-950/50 p-3 text-sm text-red-300">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            disabled={busy || !name || !orgId}
            className="rounded bg-emerald-600 px-5 py-2.5 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? "Setting up…" : "Create room and invite"}
          </button>
          <span className="text-xs text-slate-500">
            Uses your sandbox agent unless you connect a different one.
          </span>
        </div>
      </form>
    </div>
  );
}
