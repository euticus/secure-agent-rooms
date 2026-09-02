"use client";

import { useEffect, useState } from "react";
import { api, setToken } from "@/lib/api";

export default function LoginPage() {
  const [mode, setMode] = useState<"register" | "login">("login");
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [signupKey, setSignupKey] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // An invitation is itself an invitation to sign up: carry the token so a
    // closed-beta deployment doesn't dead-end the counterpart we just emailed.
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("invite");
    if (invite) {
      setInviteToken(invite);
      setMode("register");
    }
  }, []);

  function go() {
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.href = next && next.startsWith("/") ? next : "/dashboard";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") {
        const res = await api<{ token: string }>("/v1/auth/register", {
          method: "POST",
          body: {
            orgName,
            email,
            displayName: displayName || email,
            password,
            ...(signupKey ? { signupKey } : {}),
            ...(inviteToken ? { inviteToken } : {}),
          },
        });
        setToken(res.token);
      } else {
        const res = await api<{ token: string }>("/v1/auth/login", {
          method: "POST",
          body: { email, password },
        });
        setToken(res.token);
      }
      go();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="mb-4 flex gap-2 text-sm">
        {(["login", "register"] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`rounded px-3 py-1 ${mode === m ? "bg-emerald-600 text-white" : "bg-slate-800 text-slate-300"}`}
          >
            {m === "login" ? "Sign in" : "Create organization"}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-5">
        {mode === "register" && (
          <>
            <label className="block text-sm">
              Organization name
              <input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                required
                className="mt-1 w-full rounded bg-slate-800 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              Your name
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1 w-full rounded bg-slate-800 px-3 py-2 text-sm"
              />
            </label>
          </>
        )}
        <label className="block text-sm">
          Work email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 w-full rounded bg-slate-800 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-sm">
          Password
          <input
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === "register" ? 12 : undefined}
            className="mt-1 w-full rounded bg-slate-800 px-3 py-2 text-sm"
          />
          {mode === "register" && (
            <span className="mt-1 block text-xs text-slate-500">At least 12 characters.</span>
          )}
        </label>
        {inviteToken && mode === "register" && (
          <p className="rounded border border-emerald-800 bg-emerald-950/30 p-2 text-xs text-emerald-300">
            You were invited to collaborate. Create your organization and we&apos;ll take you straight to the
            invitation.
          </p>
        )}
        {mode === "register" && !inviteToken && (
          <label className="block text-sm">
            Beta signup key <span className="text-xs text-slate-500">(if your deployment requires one)</span>
            <input
              value={signupKey}
              onChange={(e) => setSignupKey(e.target.value)}
              className="mt-1 w-full rounded bg-slate-800 px-3 py-2 font-mono text-sm"
            />
          </label>
        )}
        {error && <p className="rounded bg-red-950/50 p-2 text-sm text-red-300">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded bg-emerald-600 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? "Working…" : mode === "register" ? "Create organization" : "Sign in"}
        </button>
        <p className="text-xs text-slate-500">
          Passwords are stored as salted scrypt hashes. Enterprise deployments can put an external OIDC
          identity provider in front of this instead.
        </p>
      </form>
    </div>
  );
}
