"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, getToken } from "@/lib/api";

interface AuditEvent {
  id: string; sequence: number; timestamp: string; action: string; actorType: string;
  actorId: string | null; organizationId: string | null; decision: string | null;
  resource: string | null; eventHash: string; previousHash: string;
}
interface AuditResponse {
  events: AuditEvent[];
  integrity: { chainValid: boolean; brokenAtSequence: number | null; checkpointsValid: boolean };
}

export default function AuditPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [data, setData] = useState<AuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) {
      window.location.href = "/login";
      return;
    }
    api<AuditResponse>(`/v1/rooms/${roomId}/audit`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [roomId]);

  if (error) return <p className="text-red-400">{error}</p>;
  if (!data) return <p className="text-slate-400">Loading audit record…</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Audit record</h1>
        <p className="text-sm text-slate-400">
          Every consequential operation, hash-chained so silent edits are detectable.
        </p>
      </div>

      <div
        className={`rounded border p-3 text-sm ${
          data.integrity.chainValid && data.integrity.checkpointsValid
            ? "border-emerald-800 bg-emerald-950/30 text-emerald-300"
            : "border-red-800 bg-red-950/40 text-red-300"
        }`}
      >
        {data.integrity.chainValid ? "✓ Hash chain verified" : `✗ Chain broken at #${data.integrity.brokenAtSequence}`}
        {" · "}
        {data.integrity.checkpointsValid ? "✓ Signed checkpoints valid" : "✗ Checkpoint signature invalid"}
      </div>

      <div className="overflow-x-auto rounded border border-slate-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900 text-slate-400">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Decision</th>
              <th className="px-3 py-2">Hash</th>
            </tr>
          </thead>
          <tbody>
            {data.events.map((e) => (
              <tr key={e.id} className="border-t border-slate-800">
                <td className="px-3 py-1.5 text-slate-500">{e.sequence}</td>
                <td className="px-3 py-1.5 text-slate-400">{new Date(e.timestamp).toLocaleString()}</td>
                <td className="px-3 py-1.5 font-mono">{e.action}</td>
                <td className="px-3 py-1.5 text-slate-400">{e.actorType}</td>
                <td className="px-3 py-1.5">{e.decision ?? "—"}</td>
                <td className="px-3 py-1.5 font-mono text-slate-500">{e.eventHash.slice(0, 12)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <a href={`/rooms/${roomId}`} className="inline-block text-sm text-sky-400 underline">← Back to room</a>
    </div>
  );
}
