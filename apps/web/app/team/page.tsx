"use client";

import { useCallback, useEffect, useState } from "react";
import { api, getToken } from "@/lib/api";

interface Org { id: string; name: string; role: string }
interface Member {
  membershipId: string;
  userId: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: string;
}

const ROLES = [
  { id: "owner", label: "Owner", help: "Full control, including other owners." },
  { id: "admin", label: "Admin", help: "Create rooms, set policy, decide approvals." },
  { id: "security_admin", label: "Security admin", help: "Same as admin, for security staff." },
  { id: "member", label: "Member", help: "Read-only across the organization's rooms." },
  { id: "auditor", label: "Auditor", help: "Read-only, intended for audit and review." },
];

export default function TeamPage() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("admin");
  const [initialPassword, setInitialPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      window.location.href = "/login";
      return;
    }
    api<{ organizations: Org[] }>("/v1/me")
      .then((me) => {
        setOrgs(me.organizations);
        if (me.organizations[0]) setOrgId(me.organizations[0].id);
      })
      .catch(() => (window.location.href = "/login"));
  }, []);

  const refresh = useCallback(() => {
    if (!orgId) return;
    api<Member[]>(`/v1/organizations/${orgId}/members`)
      .then(setMembers)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [orgId]);

  useEffect(refresh, [refresh]);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await api(`/v1/organizations/${orgId}/members`, {
        method: "POST",
        body: {
          email,
          displayName: displayName || undefined,
          role,
          initialPassword: initialPassword || undefined,
        },
      });
      setNotice(`${email} was added to your organization.`);
      setEmail("");
      setDisplayName("");
      setInitialPassword("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "could not add this person");
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>, message: string) {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(message);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section>
        <h1 className="mb-1 text-xl font-semibold">Your team</h1>
        <p className="mb-4 text-sm text-slate-400">
          Add colleagues so approvals and rooms are not one person&apos;s responsibility. Everyone here
          belongs to the same organization and sees the same rooms.
        </p>
        <form onSubmit={addMember} className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-5 text-sm">
          <label className="block">
            <span className="text-slate-300">Organization</span>
            <select
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              className="mt-1 w-full rounded bg-slate-800 px-3 py-2"
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name} ({o.role})</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-slate-300">Work email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 w-full rounded bg-slate-800 px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-slate-300">Name (optional)</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="mt-1 w-full rounded bg-slate-800 px-3 py-2"
            />
          </label>
          <fieldset>
            <legend className="text-slate-300">Role</legend>
            <div className="mt-1 space-y-1">
              {ROLES.map((r) => (
                <label
                  key={r.id}
                  className={`flex cursor-pointer gap-2 rounded border p-2 ${
                    role === r.id ? "border-emerald-600 bg-emerald-950/20" : "border-slate-800"
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    checked={role === r.id}
                    onChange={() => setRole(r.id)}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">{r.label}</span>
                    <span className="block text-xs text-slate-400">{r.help}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className="text-slate-300">Initial password</span>
            <input
              type="password"
              value={initialPassword}
              onChange={(e) => setInitialPassword(e.target.value)}
              minLength={12}
              className="mt-1 w-full rounded bg-slate-800 px-3 py-2"
            />
            <span className="mt-1 block text-xs text-slate-400">
              Needed only if this person has no account yet. Share it out of band and have them change it.
            </span>
          </label>
          {error && <p className="rounded bg-red-950/50 p-2 text-red-300">{error}</p>}
          {notice && <p className="rounded bg-emerald-950/40 p-2 text-emerald-300">{notice}</p>}
          <button
            disabled={busy || !orgId}
            className="w-full rounded bg-emerald-600 py-2 font-medium hover:bg-emerald-500 disabled:opacity-50"
          >
            Add to organization
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Members</h2>
        <ul className="space-y-2 text-sm">
          {members.map((m) => (
            <li key={m.membershipId} className="rounded border border-slate-800 bg-slate-900 p-3">
              <div className="flex items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{m.displayName}</span>
                  <span className="block text-xs text-slate-400">{m.email}</span>
                </span>
                <div className="flex items-center gap-2">
                  <select
                    value={m.role}
                    onChange={(e) =>
                      act(
                        () =>
                          api(`/v1/organizations/${orgId}/members/${m.membershipId}`, {
                            method: "PATCH",
                            body: { role: e.target.value },
                          }),
                        `${m.displayName} is now ${e.target.value}.`,
                      )
                    }
                    className="rounded bg-slate-800 px-2 py-1 text-xs"
                  >
                    {ROLES.map((r) => (
                      <option key={r.id} value={r.id}>{r.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={() =>
                      act(
                        () =>
                          api(`/v1/organizations/${orgId}/members/${m.membershipId}`, { method: "DELETE" }),
                        `${m.displayName} was removed.`,
                      )
                    }
                    className="rounded bg-slate-800 px-2 py-1 text-xs hover:bg-slate-700"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
          {members.length === 0 && <li className="text-slate-500">No members yet.</li>}
        </ul>
      </section>
    </div>
  );
}
