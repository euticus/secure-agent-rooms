"use client";

import { useCallback, useEffect, useState } from "react";
import { api, getToken } from "@/lib/api";

interface Org { id: string; name: string; role: string }
interface Room { id: string; name: string; state: string; createdAt: string }
interface Alert { id: string; severity: string; kind: string; detail: string; createdAt: string }
interface PendingApproval {
  id: string; roomId: string; roomName: string; action: string | null;
  eventType: string; risk: string; reason: string;
}

const STATE_COLORS: Record<string, string> = {
  ACTIVE: "bg-emerald-700",
  READY: "bg-sky-700",
  PAUSED: "bg-amber-700",
  QUARANTINED: "bg-red-700",
  COMPLETED: "bg-indigo-700",
  CLOSED: "bg-slate-700",
};

export default function Dashboard() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      window.location.href = "/login";
      return;
    }
    api<{ organizations: Org[] }>("/v1/me")
      .then((me) => {
        setOrgs(me.organizations);
        if (me.organizations[0]) setSelectedOrg(me.organizations[0].id);
      })
      .catch(() => (window.location.href = "/login"));
  }, []);

  const refresh = useCallback(() => {
    if (!selectedOrg) return;
    api<Room[]>(`/v1/rooms?organizationId=${selectedOrg}`).then(setRooms).catch((e) => setError(String(e)));
    api<Alert[]>(`/v1/security-alerts?organizationId=${selectedOrg}`).then(setAlerts).catch(() => {});
    api<PendingApproval[]>(`/v1/approvals/pending?organizationId=${selectedOrg}`).then(setPending).catch(() => {});
  }, [selectedOrg]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);


  return (
    <div className="grid gap-6 md:grid-cols-3">
      <section className="md:col-span-2">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Rooms</h1>
          <select
            value={selectedOrg ?? ""}
            onChange={(e) => setSelectedOrg(e.target.value)}
            className="rounded bg-slate-800 px-2 py-1 text-sm"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name} ({o.role})</option>
            ))}
          </select>
        </div>
        <div className="mb-4">
          <a
            href="/rooms/new"
            className="inline-block rounded bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500"
          >
            Start a room
          </a>
        </div>
        {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
        <ul className="space-y-2">
          {rooms.map((r) => (
            <li key={r.id}>
              <a
                href={`/rooms/${r.id}`}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 hover:border-slate-600"
              >
                <span>{r.name}</span>
                <span className={`rounded px-2 py-0.5 text-xs ${STATE_COLORS[r.state] ?? "bg-slate-700"}`}>
                  {r.state}
                </span>
              </a>
            </li>
          ))}
          {rooms.length === 0 && (
            <li className="rounded-lg border border-slate-800 bg-slate-900 p-5 text-sm">
              <p className="font-medium">You have no rooms yet</p>
              <p className="mt-1 text-slate-400">
                A room is one task between your company and one other. Starting one takes a minute: pick a
                template, name the task, and enter your counterpart&apos;s email — we&apos;ll configure the
                contract, your disclosure policy, and your agent, then invite them.
              </p>
              <p className="mt-2 text-xs text-slate-500">
                A sandbox agent is already connected to your organization, so you can run the whole flow —
                including a blocked credential disclosure and an approval — without any API keys.
              </p>
              <div className="mt-3 flex gap-2">
                <a href="/rooms/new" className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium">
                  Start your first room
                </a>
                <a href="/help" className="rounded bg-slate-800 px-3 py-1.5 text-sm">How it works</a>
              </div>
            </li>
          )}
        </ul>
      </section>
      <section className="space-y-6">
        <div>
          <h2 className="mb-3 text-lg font-semibold">Waiting on you</h2>
          <ul className="space-y-2 text-sm">
            {pending.map((a) => (
              <li key={a.id} className="rounded border border-amber-800 bg-amber-950/30 p-3">
                <a href={`/rooms/${a.roomId}`} className="block hover:underline">
                  <div className="font-medium text-amber-300">
                    {a.risk} risk · {a.action ?? a.eventType}
                  </div>
                  <div className="text-slate-300">{a.roomName}</div>
                  <div className="text-xs text-slate-400">{a.reason}</div>
                </a>
              </li>
            ))}
            {pending.length === 0 && <li className="text-slate-500">No approvals waiting.</li>}
          </ul>
        </div>
        <h2 className="mb-3 text-lg font-semibold">Security alerts</h2>
        <ul className="space-y-2 text-sm">
          {alerts.slice(-10).reverse().map((a) => (
            <li key={a.id} className="rounded border border-red-900/50 bg-red-950/40 p-3">
              <div className="font-medium text-red-300">{a.severity} · {a.kind}</div>
              <div className="text-slate-400">{a.detail}</div>
            </li>
          ))}
          {alerts.length === 0 && <li className="text-slate-500">No alerts.</li>}
        </ul>
      </section>
    </div>
  );
}
