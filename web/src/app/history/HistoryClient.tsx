"use client";

import { useMemo, useState } from "react";
import type { AuditRow } from "./page";

const ENTITY_LABEL: Record<string, string> = {
  interaction: "Conversation",
  voter_list: "Voter list",
  candidate: "Profile",
  reminder: "Reminder",
};

const ACTION_CHIP: Record<string, string> = {
  create: "chip-success",
  update: "chip-primary",
  delete: "chip-danger",
};

export default function HistoryClient({ initial }: { initial: AuditRow[] }) {
  const [rows] = useState<AuditRow[]>(initial);
  const [entityFilter, setEntityFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [open, setOpen] = useState<AuditRow | null>(null);

  const entities = useMemo(
    () => Array.from(new Set(rows.map((r) => r.entity_type))).sort(),
    [rows],
  );

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (entityFilter && r.entity_type !== entityFilter) return false;
        if (actionFilter && r.action !== actionFilter) return false;
        return true;
      }),
    [rows, entityFilter, actionFilter],
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="section-label">Type</span>
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="input !py-2"
          >
            <option value="">All</option>
            {entities.map((e) => (
              <option key={e} value={e}>{ENTITY_LABEL[e] ?? e}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="section-label">Action</span>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="input !py-2"
          >
            <option value="">All</option>
            <option value="create">Create</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
          </select>
        </label>
        <span className="ml-auto text-xs text-[var(--color-ink-subtle)]">
          {filtered.length} {filtered.length === 1 ? "event" : "events"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-subtle)]">No history yet.</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => (
            <li key={r.id} className="card p-4">
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`chip ${ACTION_CHIP[r.action] ?? "chip-neutral"}`}>{r.action}</span>
                    <span className="chip chip-neutral">{ENTITY_LABEL[r.entity_type] ?? r.entity_type}</span>
                  </div>
                  <p className="mt-2 text-sm text-[var(--color-ink)]">{r.summary}</p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1 text-xs text-[var(--color-ink-subtle)]">
                  <span>{new Date(r.created_at).toLocaleString()}</span>
                  {r.snapshot && (
                    <button onClick={() => setOpen(r)} className="btn-ghost text-xs">
                      View snapshot
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setOpen(null)}
        >
          <div
            className="card w-full max-w-2xl max-h-[80vh] flex flex-col p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-base font-semibold">{open.summary}</h3>
              <button onClick={() => setOpen(null)} className="btn-ghost text-xs">Close</button>
            </div>
            <p className="mb-3 text-xs text-[var(--color-ink-subtle)]">
              {new Date(open.created_at).toLocaleString()} · {open.entity_type} · {open.action}
            </p>
            <pre className="flex-1 overflow-auto rounded bg-[var(--color-surface-muted)] p-3 text-xs">
              {JSON.stringify(open.snapshot, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
