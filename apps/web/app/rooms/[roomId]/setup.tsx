"use client";

import { useState } from "react";
import { COMMON_ACTIONS, DATA_CLASSES, DISCLOSURE_RULES, HIGH_RISK_ACTIONS, SENSITIVITY_LEVELS } from "@/lib/vocab";

export interface ContractDraft {
  version: string;
  objective: string;
  participants: { organization: string; role: string }[];
  permittedDataClasses: string[];
  forbiddenDataClasses: string[];
  permittedActions: string[];
  approvalRequiredActions: string[];
  completionCriteria: { id: string; description: string; evidenceRequired: boolean; requiredEvidenceTypes: string[] }[];
}

export interface PolicyDraft {
  allowedEventTypes: string[];
  dataClassRules: Record<string, string>;
  maxAutoSensitivity: string;
  autonomousActions: string[];
  approvalRequiredActions: string[];
}

export const ALL_EVENT_TYPES = [
  "message", "clarification_request", "clarification_response", "data_request",
  "data_response", "action_proposal", "action_result", "evidence_submission", "completion_proposal",
];

export function defaultContract(customerOrg: string, providerOrg: string): ContractDraft {
  return {
    version: "1.0",
    objective: "",
    participants: [
      { organization: customerOrg, role: "customer" },
      { organization: providerOrg, role: "provider" },
    ],
    permittedDataClasses: ["architecture", "resource_inventory", "infrastructure_metadata"],
    forbiddenDataClasses: ["credential", "private_key", "customer_data", "pii"],
    permittedActions: ["read_inventory", "generate_migration_plan"],
    approvalRequiredActions: ["create_resource", "change_dns", "spend_money"],
    completionCriteria: [
      { id: "criterion_1", description: "", evidenceRequired: true, requiredEvidenceTypes: [] },
    ],
  };
}

export function defaultPolicy(): PolicyDraft {
  return {
    allowedEventTypes: [...ALL_EVENT_TYPES],
    dataClassRules: {
      architecture: "ALLOW",
      resource_inventory: "ALLOW",
      infrastructure_metadata: "ALLOW",
      performance_metric: "ALLOW",
      network_requirements: "ALLOW",
      source_code: "REQUIRE_APPROVAL",
      pii: "DENY",
      customer_data: "DENY",
    },
    maxAutoSensitivity: "CONFIDENTIAL",
    autonomousActions: ["read_inventory", "generate_migration_plan"],
    approvalRequiredActions: [],
  };
}

const chip = (on: boolean) =>
  `cursor-pointer rounded-full border px-3 py-1 text-xs ${
    on ? "border-emerald-500 bg-emerald-900/40 text-emerald-200" : "border-slate-700 text-slate-400"
  }`;

/** Structured Task Contract editor (replaces raw JSON authoring). */
export function ContractForm({
  value,
  onChange,
}: {
  value: ContractDraft;
  onChange: (v: ContractDraft) => void;
}) {
  const set = (patch: Partial<ContractDraft>) => onChange({ ...value, ...patch });
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <div className="space-y-4 text-sm">
      <label className="block">
        <span className="font-medium text-slate-200">What should the agents accomplish?</span>
        <textarea
          value={value.objective}
          onChange={(e) => set({ objective: e.target.value })}
          rows={2}
          placeholder="e.g. Produce a complete Azure migration plan for our web application"
          className="mt-1 w-full rounded bg-slate-800 px-3 py-2"
        />
      </label>

      <div>
        <p className="font-medium text-slate-200">Completion checklist</p>
        <p className="mb-2 text-xs text-slate-400">
          The task is only done when these are met — with evidence a human verifies.
        </p>
        <div className="space-y-2">
          {value.completionCriteria.map((c, i) => (
            <div key={c.id} className="flex items-center gap-2">
              <input
                value={c.description}
                onChange={(e) => {
                  const next = [...value.completionCriteria];
                  next[i] = { ...c, description: e.target.value };
                  set({ completionCriteria: next });
                }}
                placeholder={`Criterion ${i + 1} — e.g. Infrastructure inventory completed`}
                className="flex-1 rounded bg-slate-800 px-3 py-2"
              />
              <label className="flex items-center gap-1 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={c.evidenceRequired}
                  onChange={(e) => {
                    const next = [...value.completionCriteria];
                    next[i] = { ...c, evidenceRequired: e.target.checked };
                    set({ completionCriteria: next });
                  }}
                />
                evidence
              </label>
              {value.completionCriteria.length > 1 && (
                <button
                  type="button"
                  onClick={() => set({ completionCriteria: value.completionCriteria.filter((_, j) => j !== i) })}
                  className="rounded bg-slate-800 px-2 py-1 text-xs"
                >
                  remove
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            set({
              completionCriteria: [
                ...value.completionCriteria,
                {
                  id: `criterion_${value.completionCriteria.length + 1}`,
                  description: "",
                  evidenceRequired: true,
                  requiredEvidenceTypes: [],
                },
              ],
            })
          }
          className="mt-2 rounded bg-slate-800 px-3 py-1 text-xs"
        >
          + Add criterion
        </button>
      </div>

      <div>
        <p className="font-medium text-slate-200">Information both sides may exchange</p>
        <p className="mb-2 text-xs text-slate-400">Anything not selected is out of scope for this room.</p>
        <div className="flex flex-wrap gap-2">
          {DATA_CLASSES.filter((d) => !d.hardDenied).map((d) => (
            <label key={d.id} title={d.help} className={chip(value.permittedDataClasses.includes(d.id))}>
              <input
                type="checkbox"
                className="sr-only"
                checked={value.permittedDataClasses.includes(d.id)}
                onChange={() => set({ permittedDataClasses: toggle(value.permittedDataClasses, d.id) })}
              />
              {d.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="font-medium text-slate-200">Never exchanged in this room</p>
        <p className="mb-2 text-xs text-slate-400">
          Credentials, private keys, API keys and auth tokens are always blocked by the platform — you cannot
          enable them.
        </p>
        <div className="flex flex-wrap gap-2">
          {DATA_CLASSES.filter((d) => d.hardDenied).map((d) => (
            <span key={d.id} title={d.help} className="rounded-full border border-red-800 bg-red-950/40 px-3 py-1 text-xs text-red-300">
              {d.label} · always blocked
            </span>
          ))}
          {DATA_CLASSES.filter((d) => !d.hardDenied).map((d) => (
            <label key={d.id} title={d.help} className={chip(value.forbiddenDataClasses.includes(d.id))}>
              <input
                type="checkbox"
                className="sr-only"
                checked={value.forbiddenDataClasses.includes(d.id)}
                onChange={() => set({ forbiddenDataClasses: toggle(value.forbiddenDataClasses, d.id) })}
              />
              {d.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="font-medium text-slate-200">Actions</p>
        <p className="mb-2 text-xs text-slate-400">
          Autonomous actions run without asking. Approval-required actions pause for a human every time.
        </p>
        <div className="space-y-1">
          {COMMON_ACTIONS.map((a) => {
            const state = value.approvalRequiredActions.includes(a)
              ? "approval"
              : value.permittedActions.includes(a)
                ? "auto"
                : "off";
            return (
              <div key={a} className="flex items-center justify-between rounded border border-slate-800 px-3 py-1.5">
                <span className="font-mono text-xs">
                  {a}
                  {HIGH_RISK_ACTIONS.has(a) && <span className="ml-2 text-amber-400">high risk</span>}
                </span>
                <div className="flex gap-1 text-xs">
                  {(["off", "auto", "approval"] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        const permitted = value.permittedActions.filter((x) => x !== a);
                        const approval = value.approvalRequiredActions.filter((x) => x !== a);
                        if (opt === "auto") permitted.push(a);
                        if (opt === "approval") approval.push(a);
                        set({ permittedActions: permitted, approvalRequiredActions: approval });
                      }}
                      className={`rounded px-2 py-0.5 ${
                        state === opt ? "bg-emerald-700 text-white" : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {opt === "off" ? "Not allowed" : opt === "auto" ? "Autonomous" : "Ask a human"}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Structured disclosure-policy editor for one participant. */
export function PolicyForm({ value, onChange }: { value: PolicyDraft; onChange: (v: PolicyDraft) => void }) {
  const set = (patch: Partial<PolicyDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="font-medium text-slate-200">What your agent may disclose</p>
        <p className="mb-2 text-xs text-slate-400">
          Anything you don&apos;t set is denied by default. This is your side only — the other organization sets
          its own.
        </p>
        <div className="space-y-1">
          {DATA_CLASSES.filter((d) => !d.hardDenied).map((d) => {
            const rule = value.dataClassRules[d.id] ?? "DENY";
            return (
              <div key={d.id} className="flex items-center justify-between rounded border border-slate-800 px-3 py-1.5">
                <span title={d.help}>
                  {d.label}
                  <span className="block text-xs text-slate-500">{d.help}</span>
                </span>
                <div className="flex shrink-0 gap-1 text-xs">
                  {DISCLOSURE_RULES.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      title={r.help}
                      onClick={() => set({ dataClassRules: { ...value.dataClassRules, [d.id]: r.id } })}
                      className={`rounded px-2 py-0.5 ${
                        rule === r.id
                          ? r.id === "DENY"
                            ? "bg-red-800 text-white"
                            : r.id === "ALLOW"
                              ? "bg-emerald-700 text-white"
                              : "bg-amber-700 text-white"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <label className="block">
        <span className="font-medium text-slate-200">Automatic disclosure ceiling</span>
        <select
          value={value.maxAutoSensitivity}
          onChange={(e) => set({ maxAutoSensitivity: e.target.value })}
          className="mt-1 w-full rounded bg-slate-800 px-3 py-2"
        >
          {SENSITIVITY_LEVELS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-slate-400">
          Anything classified above this pauses for human approval.
        </span>
      </label>
    </div>
  );
}
