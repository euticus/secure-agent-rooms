"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api, getToken } from "@/lib/api";
import {
  ContractForm,
  PolicyForm,
  defaultContract,
  defaultPolicy,
  type ContractDraft,
  type PolicyDraft,
} from "./setup";

interface Participant {
  id: string;
  organizationId: string;
  organizationName: string;
  role: string;
  hasPolicy: boolean;
  agentConnected: boolean;
  contractApprovedVersion: number | null;
  completionApproved: boolean;
}
interface RoomDetail {
  room: {
    id: string; name: string; state: string;
    budget: Record<string, number>; usage: Record<string, number | null>;
  };
  participants: Participant[];
  contract: { version: number; contract: ContractDraft } | null;
  completion: { satisfied: boolean; verified: boolean; criteria: { id: string; description: string; state: string }[] };
}
interface RoomEvent {
  id: string; sequence: number; senderParticipantId: string | null; type: string;
  createdAt: string; body: Record<string, unknown>; policy: { decision: string };
}
interface Approval {
  id: string; eventType: string; action: string | null; risk: string; reason: string;
  status: string; candidateBody: Record<string, unknown>; approverOrgId: string;
}
interface Evidence {
  id: string; criterionId: string; evidenceType: string; description: string;
  reference: string | null; verification: string;
}
interface Conn { id: string; name: string; adapterType: string; status: string }
interface SetupStatus {
  roomState: string;
  canStart: boolean;
  nextAction: string | null;
  steps: { id: string; label: string; done: boolean; yours: boolean }[];
}
interface Org { id: string; name: string }

const STATE_HELP: Record<string, string> = {
  DRAFT: "Add a task contract and invite the other organization.",
  INVITED: "Waiting for the other organization to accept the invitation.",
  NEGOTIATING: "Both sides must set a policy, connect an agent, and approve the contract.",
  READY: "Everything is agreed. Start the room when you're ready.",
  ACTIVE: "Agents are collaborating. You'll be asked to approve anything consequential.",
  PAUSED: "Paused — resume when you're ready.",
  COMPLETION_PROPOSED: "An agent says the task is done. Verify evidence, then both sides approve.",
  COMPLETED: "Both organizations approved completion.",
  CLOSED: "Closed. The audit record is finalized.",
  QUARANTINED: "Security hold — a human must review before this room can continue.",
  CANCELED: "Canceled.",
};

function EventCard({ ev, participants }: { ev: RoomEvent; participants: Participant[] }) {
  const sender = participants.find((p) => p.id === ev.senderParticipantId);
  const label = sender ? `${sender.organizationName} agent` : "platform";
  const styles: Record<string, string> = {
    policy_block: "border-red-800 bg-red-950/40",
    security_alert: "border-red-800 bg-red-950/40",
    approval_request: "border-amber-800 bg-amber-950/40",
    action_authorized: "border-emerald-800 bg-emerald-950/30",
    action_rejected: "border-red-800 bg-red-950/30",
    data_request: "border-sky-900 bg-sky-950/30",
    data_response: "border-sky-900 bg-sky-950/30",
    evidence_submission: "border-indigo-900 bg-indigo-950/30",
    room_pause: "border-amber-800 bg-amber-950/40",
  };

  // "Why was this blocked?" — explainability for policy blocks (spec §51).
  if (ev.type === "policy_block") {
    return (
      <div className="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-sm">
        <div className="mb-1 text-xs text-slate-400">#{ev.sequence} · blocked disclosure</div>
        <p className="font-medium text-red-300">
          Blocked {String(ev.body.blockedEventType ?? "message")} — {String(ev.body.reason ?? "")}
        </p>
        <dl className="mt-1 space-y-0.5 text-xs text-slate-300">
          <div><span className="text-slate-500">Rule: </span><span className="font-mono">{String(ev.body.rule ?? "")}</span></div>
          <div><span className="text-slate-500">The agent was told: </span>{String(ev.body.guidance ?? "")}</div>
        </dl>
        <p className="mt-1 text-xs text-slate-500">The blocked content itself was never sent or stored.</p>
      </div>
    );
  }

  return (
    <div className={`rounded border px-3 py-2 text-sm ${styles[ev.type] ?? "border-slate-800 bg-slate-900"}`}>
      <div className="mb-1 flex justify-between text-xs text-slate-400">
        <span>#{ev.sequence} · {label} · <span className="font-mono">{ev.type}</span></span>
        <span>{new Date(ev.createdAt).toLocaleTimeString()}</span>
      </div>
      {/* Untrusted content rendered as text only — React escapes by default. */}
      <pre className="whitespace-pre-wrap break-words font-sans text-slate-200">
        {typeof ev.body.text === "string" ? ev.body.text : JSON.stringify(ev.body, null, 1)}
      </pre>
    </div>
  );
}

export default function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [detail, setDetail] = useState<RoomDetail | null>(null);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [conns, setConns] = useState<Conn[]>([]);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [contractDraft, setContractDraft] = useState<ContractDraft | null>(null);
  const [policyDraft, setPolicyDraft] = useState<PolicyDraft>(defaultPolicy());
  const [selectedConn, setSelectedConn] = useState("");
  const [compose, setCompose] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [setup, setSetup] = useState<SetupStatus | null>(null);

  const myOrgIds = useMemo(() => new Set(orgs.map((o) => o.id)), [orgs]);
  const myParticipant = detail?.participants.find((p) => myOrgIds.has(p.organizationId));

  const refresh = useCallback(() => {
    api<RoomDetail>(`/v1/rooms/${roomId}`)
      .then((d) => {
        setDetail(d);
        setContractDraft((prev) => prev ?? d.contract?.contract ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    api<RoomEvent[]>(`/v1/rooms/${roomId}/events`).then(setEvents).catch(() => {});
    api<Approval[]>(`/v1/rooms/${roomId}/approvals`).then(setApprovals).catch(() => {});
    api<Evidence[]>(`/v1/rooms/${roomId}/evidence`).then(setEvidence).catch(() => {});
    api<SetupStatus>(`/v1/rooms/${roomId}/setup`).then(setSetup).catch(() => {});
  }, [roomId]);

  useEffect(() => {
    if (!getToken()) {
      window.location.href = "/login";
      return;
    }
    api<{ organizations: Org[] }>("/v1/me").then((me) => setOrgs(me.organizations));
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (myParticipant) {
      api<Conn[]>(`/v1/agent-connections?organizationId=${myParticipant.organizationId}`)
        .then((c) => {
          setConns(c);
          setSelectedConn((prev) => prev || c[0]?.id || "");
        })
        .catch(() => {});
    }
  }, [myParticipant?.organizationId]);

  // Seed a contract draft with real org names once participants are known.
  useEffect(() => {
    if (!contractDraft && detail && detail.participants.length > 0 && !detail.contract) {
      const customer = detail.participants.find((p) => p.role === "customer")?.organizationName ?? "Customer";
      const provider = detail.participants.find((p) => p.role === "provider")?.organizationName ?? "Provider";
      setContractDraft(defaultContract(customer, provider));
    }
  }, [detail, contractDraft]);

  /** All mutations go through here so every server rejection is surfaced. */
  async function act(path: string, body?: unknown, successMessage?: string, method: "POST" | "PUT" = "POST") {
    setError(null);
    setNotice(null);
    try {
      await api(path, { method, body: body ?? {} });
      if (successMessage) setNotice(successMessage);
      refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
      return false;
    }
  }

  if (!detail) {
    return (
      <p className="text-slate-400">
        Loading…{error && <span className="text-red-400"> {error}</span>}
      </p>
    );
  }
  const { room } = detail;
  const setupNeeded = ["DRAFT", "INVITED", "NEGOTIATING", "READY"].includes(room.state);
  const canCompose = ["ACTIVE", "COMPLETION_PROPOSED"].includes(room.state) && myParticipant;
  const pendingApprovals = approvals.filter((a) => a.status === "PENDING");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{room.name}</h1>
          <p className="text-sm text-slate-400">
            <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs">{room.state}</span>
            {" · "}turns {String(room.usage.turns ?? 0)}/{room.budget.maxTurns}
            {" · "}spend ${Number(room.usage.modelSpendUsd ?? 0).toFixed(2)}/${room.budget.maxModelSpendUsd}
          </p>
          <p className="mt-1 text-xs text-slate-500">{STATE_HELP[room.state]}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {room.state === "READY" && (
            <button onClick={() => act(`/v1/rooms/${roomId}/start`, {}, "Room started — agents are running.")} className="rounded bg-emerald-600 px-3 py-1.5">Start room</button>
          )}
          {room.state === "ACTIVE" && (
            <>
              <button onClick={() => act(`/v1/rooms/${roomId}/step`, {}, "Ran an agent turn.")} className="rounded bg-sky-700 px-3 py-1.5">Run a turn</button>
              <button onClick={() => act(`/v1/rooms/${roomId}/pause`, {}, "Room paused.")} className="rounded bg-amber-600 px-3 py-1.5">Pause</button>
            </>
          )}
          {(room.state === "PAUSED" || room.state === "QUARANTINED") && (
            <button onClick={() => act(`/v1/rooms/${roomId}/resume`, {}, "Room resumed.")} className="rounded bg-emerald-600 px-3 py-1.5">Resume</button>
          )}
          {room.state === "COMPLETION_PROPOSED" && (
            <button onClick={() => act(`/v1/rooms/${roomId}/completion/approve`, {}, "Completion approved on your side.")} className="rounded bg-indigo-600 px-3 py-1.5">Approve completion</button>
          )}
          {room.state !== "CLOSED" && (
            <button onClick={() => act(`/v1/rooms/${roomId}/close`, {}, "Room closed and audit finalized.")} className="rounded bg-slate-700 px-3 py-1.5">Close</button>
          )}
          <button onClick={() => setShowSetup((s) => !s)} className="rounded bg-slate-800 px-3 py-1.5">
            {showSetup ? "Hide setup" : "Setup"}
          </button>
        </div>
      </div>

      {error && <p className="rounded border border-red-800 bg-red-950/50 p-3 text-sm text-red-300">{error}</p>}
      {notice && <p className="rounded border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-300">{notice}</p>}

      <div className="grid gap-3 text-sm md:grid-cols-2">
        {detail.participants.map((p) => (
          <div key={p.id} className="rounded border border-slate-800 bg-slate-900 px-4 py-2">
            <span className="font-medium">{p.organizationName}</span>
            <span className="ml-2 text-xs text-slate-400">{p.role}</span>
            {myOrgIds.has(p.organizationId) && <span className="ml-2 text-xs text-emerald-400">you</span>}
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-400">
              <span>{p.hasPolicy ? "✓ policy set" : "○ policy pending"}</span>
              <span>{p.agentConnected ? "✓ agent connected" : "○ agent pending"}</span>
              <span>{p.contractApprovedVersion ? `✓ approved contract v${p.contractApprovedVersion}` : "○ contract not approved"}</span>
              {p.completionApproved && <span className="text-emerald-400">✓ completion approved</span>}
            </div>
          </div>
        ))}
        {detail.participants.length < 2 && (
          <div className="rounded border border-dashed border-slate-700 px-4 py-2 text-xs text-slate-500">
            Waiting for the other organization to accept the invitation.
          </div>
        )}
      </div>

      {setup && !setup.canStart && setupNeeded && (
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Before this room can start</h2>
            {setup.nextAction && (
              <span className="text-xs text-amber-300">Next: {setup.nextAction}</span>
            )}
          </div>
          <ul className="grid gap-1 text-sm md:grid-cols-2">
            {setup.steps.map((st) => (
              <li key={st.id} className="flex items-start gap-2">
                <span className={st.done ? "text-emerald-400" : "text-slate-600"}>
                  {st.done ? "✓" : "○"}
                </span>
                <span className={st.done ? "text-slate-400" : "text-slate-200"}>
                  {st.label}
                  {!st.yours && <span className="ml-1 text-xs text-slate-500">(other company)</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(setupNeeded || showSetup) && myParticipant && contractDraft && (
        <div className="space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-5">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-1 font-semibold">
                1. Task contract {detail.contract && <span className="text-xs text-slate-400">(current: v{detail.contract.version})</span>}
              </h3>
              <p className="mb-3 text-xs text-slate-400">
                Both organizations must approve the same version. Any change re-opens approval on both sides.
              </p>
              <ContractForm value={contractDraft} onChange={setContractDraft} />
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <button
                  onClick={() => act(`/v1/rooms/${roomId}/contract`, { contract: contractDraft }, "Contract proposed.", "PUT")}
                  className="rounded bg-sky-700 px-3 py-1"
                >
                  Propose contract
                </button>
                {detail.contract && (
                  <button
                    onClick={() => act(`/v1/rooms/${roomId}/contract/approve`, { version: detail.contract!.version }, `Approved contract v${detail.contract!.version}.`)}
                    className="rounded bg-emerald-700 px-3 py-1"
                  >
                    Approve v{detail.contract.version}
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <h3 className="mb-1 font-semibold">2. Your disclosure policy</h3>
                <p className="mb-3 text-xs text-slate-400">
                  Applies to your organization only. Anything unset is denied.
                </p>
                <PolicyForm value={policyDraft} onChange={setPolicyDraft} />
                <button
                  onClick={() => act(`/v1/rooms/${roomId}/policy`, { policy: policyDraft }, "Policy saved.", "PUT")}
                  className="mt-3 rounded bg-sky-700 px-3 py-1 text-sm"
                >
                  Save policy
                </button>
              </div>

              <div>
                <h3 className="mb-1 font-semibold">3. Your agent</h3>
                {conns.length === 0 ? (
                  <p className="text-sm text-amber-300">
                    No agent connections yet. <a href="/agents" className="underline">Connect an agent</a> first
                    — you can use the built-in sandbox agent with no credentials.
                  </p>
                ) : (
                  <div className="flex gap-2">
                    <select
                      value={selectedConn}
                      onChange={(e) => setSelectedConn(e.target.value)}
                      className="flex-1 rounded bg-slate-800 px-2 py-1 text-sm"
                    >
                      {conns.map((c) => (
                        <option key={c.id} value={c.id}>{c.name} ({c.adapterType})</option>
                      ))}
                    </select>
                    <button
                      onClick={() => selectedConn && act(`/v1/rooms/${roomId}/agent`, { agentConnectionId: selectedConn }, "Agent connected.")}
                      className="rounded bg-emerald-700 px-3 py-1 text-sm"
                    >
                      Connect
                    </button>
                  </div>
                )}
              </div>

              <div>
                <h3 className="mb-1 font-semibold">4. Invite the other organization</h3>
                <button
                  onClick={async () => {
                    setError(null);
                    try {
                      const r = await api<{ token: string }>(`/v1/rooms/${roomId}/invites`, { method: "POST", body: {} });
                      setInviteToken(r.token);
                      refresh();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "failed to create invite");
                    }
                  }}
                  className="rounded bg-sky-700 px-3 py-1 text-sm"
                >
                  Generate invite link
                </button>
                {inviteToken && (
                  <div className="mt-2">
                    <p className="text-xs text-slate-400">
                      Send this to your counterpart. They sign in, review exactly what would be shared, and accept.
                      It expires, works once, and grants no access to room content by itself.
                    </p>
                    <div className="mt-1 flex gap-2">
                      <input
                        readOnly
                        value={`${typeof window !== "undefined" ? window.location.origin : ""}/invite?token=${inviteToken}`}
                        className="flex-1 rounded bg-slate-800 px-2 py-1 font-mono text-xs"
                      />
                      <button
                        onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/invite?token=${inviteToken}`)}
                        className="rounded bg-slate-700 px-3 py-1 text-xs"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingApprovals.map((a) => (
        <div key={a.id} className="rounded-lg border border-amber-700 bg-amber-950/30 p-4">
          <p className="text-sm font-medium text-amber-300">
            Approval required · {a.risk} risk · {a.action ?? a.eventType}
          </p>
          <p className="mb-2 text-sm text-slate-300">{a.reason}</p>
          <pre className="mb-3 overflow-auto rounded bg-slate-900 p-2 text-xs text-slate-300">
            {JSON.stringify(a.candidateBody, null, 2)}
          </pre>
          {myOrgIds.has(a.approverOrgId) ? (
            <div className="flex gap-2 text-sm">
              <button onClick={() => act(`/v1/approvals/${a.id}/reject`, {}, "Rejected.")} className="rounded bg-slate-700 px-4 py-1.5">
                Reject
              </button>
              <button onClick={() => act(`/v1/approvals/${a.id}/approve`, {}, "Approved once — the exact parameters above were released.")} className="rounded bg-emerald-600 px-4 py-1.5">
                Approve once
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-400">Awaiting the other organization&apos;s approval.</p>
          )}
        </div>
      ))}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <h2 className="mb-2 font-semibold">Conversation</h2>
          <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
            {events
              .filter((e) => e.type !== "approval_request")
              .map((e) => <EventCard key={e.id} ev={e} participants={detail.participants} />)}
            {events.length === 0 && (
              <p className="text-sm text-slate-500">
                No events yet. {room.state === "ACTIVE" ? "Agents run automatically — or press “Run a turn”." : ""}
              </p>
            )}
          </div>
          {canCompose && (
            <form
              className="mt-3 flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!compose.trim()) return;
                const ok = await act(
                  `/v1/rooms/${roomId}/participants/${myParticipant!.id}/events`,
                  { candidate: { body: { type: "message", text: compose } } },
                  "Message submitted to the policy pipeline.",
                );
                if (ok) setCompose("");
              }}
            >
              <input
                value={compose}
                onChange={(e) => setCompose(e.target.value)}
                placeholder="Send a message as your organization (goes through the same policy checks)"
                className="flex-1 rounded bg-slate-800 px-3 py-2 text-sm"
              />
              <button className="rounded bg-sky-700 px-4 py-2 text-sm">Send</button>
            </form>
          )}
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="mb-2 font-semibold">Checklist</h2>
            <ul className="space-y-1 text-sm">
              {detail.completion.criteria.map((c) => (
                <li key={c.id} className="flex items-start gap-2">
                  <span className={c.state === "VERIFIED" ? "text-emerald-400" : c.state === "EVIDENCE_SUBMITTED" ? "text-amber-400" : "text-slate-500"}>
                    {c.state === "VERIFIED" ? "✓" : c.state === "EVIDENCE_SUBMITTED" ? "⚠" : "○"}
                  </span>
                  <span>
                    {c.description}
                    <span className="block text-xs text-slate-500">
                      {c.state === "VERIFIED" ? "human-verified" : c.state === "EVIDENCE_SUBMITTED" ? "evidence claimed — needs your verification" : "no evidence yet"}
                    </span>
                  </span>
                </li>
              ))}
              {detail.completion.criteria.length === 0 && <li className="text-slate-500">No criteria defined.</li>}
            </ul>
          </div>
          <div>
            <h2 className="mb-2 font-semibold">Evidence</h2>
            <ul className="space-y-2 text-sm">
              {evidence.map((e) => (
                <li key={e.id} className="rounded border border-slate-800 bg-slate-900 p-2">
                  <div className="text-xs text-slate-400">
                    {e.criterionId} · {e.evidenceType} ·{" "}
                    <span className={e.verification === "HUMAN_VERIFIED" ? "text-emerald-400" : "text-amber-400"}>
                      {e.verification}
                    </span>
                  </div>
                  <div>{e.description}</div>
                  {e.reference && <div className="break-all font-mono text-xs text-slate-500">{e.reference}</div>}
                  {e.verification === "CLAIMED" && (
                    <button
                      onClick={() => act(`/v1/rooms/${roomId}/evidence/${e.id}/verify`, {}, "Evidence marked human-verified.")}
                      className="mt-1 rounded bg-indigo-700 px-2 py-0.5 text-xs"
                    >
                      Mark human-verified
                    </button>
                  )}
                </li>
              ))}
              {evidence.length === 0 && <li className="text-slate-500">No evidence yet.</li>}
            </ul>
          </div>
          <div>
            <h2 className="mb-2 font-semibold">Security &amp; policy timeline</h2>
            <ul className="space-y-1 text-xs text-slate-400">
              {events
                .filter((e) => ["policy_block", "approval_request", "action_authorized", "action_rejected", "room_pause", "security_alert"].includes(e.type))
                .map((e) => (
                  <li key={e.id} className="rounded bg-slate-900 px-2 py-1">
                    #{e.sequence} <span className="font-mono">{e.type}</span>
                    {typeof e.body.reason === "string" && ` — ${e.body.reason}`}
                  </li>
                ))}
              {events.filter((e) => ["policy_block", "approval_request", "action_authorized", "room_pause"].includes(e.type)).length === 0 && (
                <li className="text-slate-500">Nothing blocked or escalated yet.</li>
              )}
            </ul>
            <a href={`/rooms/${roomId}/audit`} className="mt-2 inline-block text-xs text-sky-400 underline">
              View audit record →
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
