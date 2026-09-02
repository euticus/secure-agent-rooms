"use client";

import { useEffect, useState } from "react";
import { api, getToken } from "@/lib/api";

interface Preview {
  roomName: string;
  invitingOrganization: string;
  expiresAt: string;
  contractSummary: {
    objective: string;
    permittedDataClasses: string[];
    forbiddenDataClasses: string[];
    approvalRequiredActions: string[];
  } | null;
}
interface Org { id: string; name: string }
interface AcceptResult { roomId: string; roomName: string; state: string; ready: boolean; remaining: string[] }

/**
 * The invited side. One review, one button: joining also sets a policy derived
 * from the agreed contract, connects their sandbox agent, and approves the
 * contract — everything they would otherwise have done across four screens.
 */
export default function InvitePage() {
  const [token, setToken] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState<AcceptResult | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!getToken()) {
      // Carry the invitation through sign-in so the link works from a cold start.
      window.location.href = t
        ? `/login?next=${encodeURIComponent(`/invite?token=${t}`)}&invite=${encodeURIComponent(t)}`
        : "/login";
      return;
    }
    if (t) {
      setToken(t);
      api<Preview>(`/v1/invites/${encodeURIComponent(t)}`)
        .then(setPreview)
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }
    api<{ organizations: Org[] }>("/v1/me").then((me) => {
      setOrgs(me.organizations);
      if (me.organizations[0]) setOrgId(me.organizations[0].id);
    });
  }, []);

  async function loadPreview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setPreview(await api<Preview>(`/v1/invites/${encodeURIComponent(token)}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not load this invitation");
    }
  }

  async function accept() {
    setError(null);
    setBusy(true);
    try {
      setAccepted(
        await api<AcceptResult>(`/v1/invites/${encodeURIComponent(token)}/accept`, {
          method: "POST",
          body: { organizationId: orgId },
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not accept this invitation");
    } finally {
      setBusy(false);
    }
  }

  if (accepted) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-5">
          <h1 className="text-lg font-semibold text-emerald-300">You&apos;re in</h1>
          <p className="mt-1 text-sm text-slate-300">
            You joined <span className="font-medium">{accepted.roomName}</span>. Your disclosure policy and
            agent are set, and you approved the contract.
          </p>
          {accepted.ready ? (
            <p className="mt-2 text-sm text-emerald-300">
              The room is ready — either side can start it now.
            </p>
          ) : (
            <ul className="mt-2 ml-4 list-disc text-sm text-slate-400">
              {accepted.remaining.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex gap-2">
          <a href={`/rooms/${accepted.roomId}`} className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium">
            Open the room
          </a>
          <a href="/dashboard" className="rounded bg-slate-800 px-4 py-2 text-sm">Dashboard</a>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">Review an invitation</h1>
      {!preview && (
        <form onSubmit={loadPreview} className="flex gap-2">
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste your invitation token"
            className="flex-1 rounded bg-slate-800 px-3 py-2 text-sm"
          />
          <button className="rounded bg-sky-600 px-4 py-2 text-sm">Review</button>
        </form>
      )}
      {error && <p className="rounded border border-red-800 bg-red-950/50 p-3 text-sm text-red-300">{error}</p>}

      {preview && (
        <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5 text-sm">
          <p>
            <span className="font-semibold">{preview.invitingOrganization}</span> invited you to collaborate on{" "}
            <span className="font-semibold">{preview.roomName}</span>.
          </p>
          {preview.contractSummary && (
            <>
              <p className="text-slate-300">The task: {preview.contractSummary.objective}</p>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <p className="mb-1 font-medium text-emerald-400">Your agent may share</p>
                  <ul className="space-y-0.5 text-xs text-slate-400">
                    {preview.contractSummary.permittedDataClasses.map((c) => (
                      <li key={c}>{c.replaceAll("_", " ")}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 font-medium text-red-400">Never exchanged</p>
                  <ul className="space-y-0.5 text-xs text-slate-400">
                    {preview.contractSummary.forbiddenDataClasses.map((c) => (
                      <li key={c}>{c.replaceAll("_", " ")}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 font-medium text-amber-400">Stops for your approval</p>
                  <ul className="space-y-0.5 text-xs text-slate-400">
                    {preview.contractSummary.approvalRequiredActions.map((c) => (
                      <li key={c}>{c.replaceAll("_", " ")}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}
          <p className="rounded bg-slate-950/50 p-3 text-xs text-slate-400">
            Accepting sets a disclosure policy matching this contract, connects your sandbox agent, and
            records your approval of this exact contract version. You can change any of it before the room
            starts, and credentials can never be exchanged regardless.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {orgs.length > 1 && (
              <select
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                className="rounded bg-slate-800 px-2 py-2 text-sm"
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            )}
            <button
              onClick={accept}
              disabled={busy || !orgId}
              className="rounded bg-emerald-600 px-5 py-2.5 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy ? "Joining…" : "Accept and set up"}
            </button>
            <a href="/dashboard" className="text-xs text-slate-400 underline">Not now</a>
          </div>
        </div>
      )}
    </div>
  );
}
