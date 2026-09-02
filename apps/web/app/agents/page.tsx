"use client";

import { useCallback, useEffect, useState } from "react";
import { api, getToken } from "@/lib/api";
import { ADAPTER_TYPES } from "@/lib/vocab";

interface Org { id: string; name: string; role: string }
interface Conn {
  id: string;
  name: string;
  adapterType: string;
  status: string;
  endpoint: string | null;
  createdAt: string;
}

export default function AgentsPage() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgId, setOrgId] = useState("");
  const [conns, setConns] = useState<Conn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [adapterType, setAdapterType] = useState("SCRIPTED");
  const [credentialSlug, setCredentialSlug] = useState("");
  const [envVarHint, setEnvVarHint] = useState<string | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [agentCardHash, setAgentCardHash] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  const selected = ADAPTER_TYPES.find((a) => a.id === adapterType)!;

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
    api<Conn[]>(`/v1/agent-connections?organizationId=${orgId}`).then(setConns).catch(() => {});
  }, [orgId]);

  useEffect(refresh, [refresh]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const config: Record<string, unknown> = {};
      if (model) config.model = model;
      if (baseUrl) config.baseUrl = baseUrl;
      const created = await api<{ credentialEnvVar?: string }>("/v1/agent-connections", {
        method: "POST",
        body: {
          organizationId: orgId,
          name: name || selected.label,
          adapterType,
          ...(credentialSlug ? { credentialSlug } : {}),
          ...(endpoint ? { endpoint } : {}),
          ...(agentCardHash ? { agentCardHash } : {}),
          ...(Object.keys(config).length ? { config } : {}),
        },
      });
      setNotice("Agent connection created. You can now select it in a room.");
      setEnvVarHint(created.credentialEnvVar ?? null);
      setName("");
      setCredentialSlug("");
      setEndpoint("");
      setAgentCardHash("");
      setModel("");
      setBaseUrl("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create connection");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section>
        <h1 className="mb-1 text-xl font-semibold">Connect an agent</h1>
        <p className="mb-4 text-sm text-slate-400">
          Your agent stays yours. We never receive its credentials — only an opaque reference to a
          secret your environment holds — and the other organization never talks to it directly.
        </p>
        <form onSubmit={create} className="space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-5 text-sm">
          <label className="block">
            <span className="text-slate-300">Organization</span>
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

          <fieldset>
            <legend className="text-slate-300">Agent type</legend>
            <div className="mt-1 space-y-2">
              {ADAPTER_TYPES.map((a) => (
                <label
                  key={a.id}
                  className={`flex cursor-pointer gap-2 rounded border p-2 ${
                    adapterType === a.id ? "border-emerald-600 bg-emerald-950/20" : "border-slate-800"
                  }`}
                >
                  <input
                    type="radio"
                    name="adapterType"
                    value={a.id}
                    checked={adapterType === a.id}
                    onChange={() => setAdapterType(a.id)}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">{a.label}</span>
                    <span className="block text-xs text-slate-400">{a.help}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block">
            <span className="text-slate-300">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={selected.label}
              className="mt-1 w-full rounded bg-slate-800 px-3 py-2"
            />
          </label>

          {selected.needs.includes("credentialReference" as never) && (
            <label className="block">
              <span className="text-slate-300">Credential name</span>
              <input
                value={credentialSlug}
                onChange={(e) => setCredentialSlug(e.target.value.replace(/[^A-Za-z0-9_-]/g, ""))}
                placeholder="openai"
                className="mt-1 w-full rounded bg-slate-800 px-3 py-2 font-mono"
              />
              <span className="mt-1 block text-xs text-slate-400">
                A short name for the secret — not the key itself, and not an environment variable. We derive a
                variable name scoped to your organization and tell you what to set. The platform stores only
                that reference.
              </span>
            </label>
          )}

          {adapterType === "HOSTED_OPENAI" && (
            <label className="block">
              <span className="text-slate-300">Base URL (optional)</span>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="mt-1 w-full rounded bg-slate-800 px-3 py-2 font-mono"
              />
            </label>
          )}

          {(adapterType === "HOSTED_OPENAI" || adapterType === "HOSTED_ANTHROPIC") && (
            <label className="block">
              <span className="text-slate-300">Model (optional)</span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={adapterType === "HOSTED_ANTHROPIC" ? "claude-opus-5" : "gpt-4o"}
                className="mt-1 w-full rounded bg-slate-800 px-3 py-2 font-mono"
              />
            </label>
          )}

          {selected.needs.includes("endpoint" as never) && (
            <>
              <label className="block">
                <span className="text-slate-300">A2A base URL</span>
                <input
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://agents.example.com"
                  className="mt-1 w-full rounded bg-slate-800 px-3 py-2 font-mono"
                />
              </label>
              <label className="block">
                <span className="text-slate-300">Pinned agent card hash</span>
                <input
                  value={agentCardHash}
                  onChange={(e) => setAgentCardHash(e.target.value)}
                  placeholder="sha256 of /.well-known/agent-card.json"
                  className="mt-1 w-full rounded bg-slate-800 px-3 py-2 font-mono"
                />
                <span className="mt-1 block text-xs text-slate-400">
                  We refuse to run the agent if its card changes — that&apos;s the rug-pull protection.
                </span>
              </label>
            </>
          )}

          {error && <p className="rounded bg-red-950/50 p-2 text-red-300">{error}</p>}
          {notice && (
            <div className="rounded bg-emerald-950/40 p-2 text-emerald-300">
              <p>{notice}</p>
              {envVarHint && (
                <p className="mt-1 text-xs text-emerald-200">
                  Set this environment variable on the server, then restart it:{" "}
                  <code className="font-mono">{envVarHint}</code>
                </p>
              )}
            </div>
          )}
          <button
            disabled={busy || !orgId}
            className="w-full rounded bg-emerald-600 py-2 font-medium hover:bg-emerald-500 disabled:opacity-50"
          >
            Create connection
          </button>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Your connections</h2>
        <ul className="space-y-2 text-sm">
          {conns.map((c) => (
            <li key={c.id} className="rounded border border-slate-800 bg-slate-900 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{c.name}</span>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    c.status === "ACTIVE" ? "bg-emerald-800" : c.status === "DISABLED" ? "bg-slate-700" : "bg-amber-700"
                  }`}
                >
                  {c.status}
                </span>
              </div>
              <div className="text-xs text-slate-400">
                {ADAPTER_TYPES.find((a) => a.id === c.adapterType)?.label ?? c.adapterType}
                {c.endpoint && ` · ${c.endpoint}`}
              </div>
              {c.status === "NEEDS_REAPPROVAL" && (
                <p className="mt-1 text-xs text-amber-300">
                  This agent&apos;s configuration changed since approval. Review and recreate the connection.
                </p>
              )}
            </li>
          ))}
          {conns.length === 0 && <li className="text-slate-500">No connections yet.</li>}
        </ul>
      </section>
    </div>
  );
}
