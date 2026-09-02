"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { API_BASE, api, getToken, setToken } from "@/lib/api";

/** Routes that render their own full-page chrome (marketing / docs). */
const BARE_ROUTES = ["/", "/docs"];

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = BARE_ROUTES.includes(pathname ?? "");
  if (bare) return <>{children}</>;
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <NavBar />
      {children}
    </div>
  );
}

export function NavBar() {
  const [signedIn, setSignedIn] = useState(false);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const token = getToken();
    setSignedIn(!!token);
    if (!token) return;
    // Approvals block the work, so their count belongs in the chrome — nobody
    // should have to be staring at a room page to discover one is waiting.
    const load = async () => {
      try {
        const me = await api<{ organizations: { id: string }[] }>("/v1/me");
        const counts = await Promise.all(
          me.organizations.map((o) =>
            api<unknown[]>(`/v1/approvals/pending?organizationId=${o.id}`)
              .then((r) => r.length)
              .catch(() => 0),
          ),
        );
        setPending(counts.reduce((a, b) => a + b, 0));
      } catch {
        /* signed out or offline */
      }
    };
    void load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  async function logout() {
    const token = getToken();
    if (token) {
      // Revoke server-side so the bearer cannot be replayed.
      await fetch(`${API_BASE}/v1/auth/logout`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    setToken(null);
    window.location.href = "/";
  }

  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
      <a href="/dashboard" className="text-lg font-semibold tracking-tight">
        <span className="text-emerald-400">●</span> Secure Agent Rooms
      </a>
      <nav className="flex flex-wrap items-center gap-4 text-sm text-slate-400">
        <a href="/dashboard" className="hover:text-slate-200">Dashboard</a>
        <a href="/agents" className="hover:text-slate-200">Agents</a>
        <a href="/team" className="hover:text-slate-200">Team</a>
        {pending > 0 && (
          <a
            href="/dashboard"
            className="rounded-full bg-amber-600 px-2.5 py-0.5 text-xs font-medium text-white"
            title="Approvals waiting on you"
          >
            {pending} awaiting approval
          </a>
        )}
        <a href="/invite" className="hover:text-slate-200">Redeem invite</a>
        <a href="/docs" className="hover:text-slate-200">Docs</a>
        {signedIn ? (
          <button onClick={logout} className="rounded bg-slate-800 px-3 py-1 hover:text-slate-200">
            Sign out
          </button>
        ) : (
          <a href="/login" className="hover:text-slate-200">Sign in</a>
        )}
      </nav>
    </header>
  );
}
