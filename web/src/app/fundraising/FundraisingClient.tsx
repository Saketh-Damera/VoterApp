"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AIActionButton, { CopyBox } from "@/components/AIActionButton";
import type { Prospect } from "./page";

const STATUSES: Prospect["status"][] = ["prospect", "asked", "committed", "donated", "declined"];

type AskDraft = {
  channel: "email" | "phone_script" | "text";
  subject: string | null;
  body: string;
  suggested_amount: number;
  rationale: string;
};

export default function FundraisingClient({
  initial,
  goal,
}: {
  initial: Prospect[];
  goal: number | null;
}) {
  const router = useRouter();
  const [prospects, setProspects] = useState<Prospect[]>(initial);
  const [showForm, setShowForm] = useState(false);

  const [f, setF] = useState({
    full_name: "",
    email: "",
    phone: "",
    employer: "",
    role: "",
    estimated_capacity: "",
    status: "prospect" as Prospect["status"],
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  const committed = prospects
    .filter((p) => p.status === "committed" || p.status === "donated")
    .reduce((a, p) => a + (p.committed_amount ?? 0), 0);
  const donated = prospects
    .filter((p) => p.status === "donated")
    .reduce((a, p) => a + (p.donated_amount ?? 0), 0);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!f.full_name.trim()) return;
    setSaving(true);
    const res = await fetch("/api/fundraising", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...f,
        estimated_capacity: f.estimated_capacity ? parseFloat(f.estimated_capacity) : null,
      }),
    });
    const json = await res.json();
    setSaving(false);
    if (json.ok) {
      setProspects([json.prospect, ...prospects]);
      setShowForm(false);
      setF({ full_name: "", email: "", phone: "", employer: "", role: "", estimated_capacity: "", status: "prospect", notes: "" });
      router.refresh();
    }
  }

  async function update(id: string, patch: Partial<Prospect>) {
    setProspects(prospects.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    await fetch(`/api/fundraising/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    router.refresh();
  }

  async function del(id: string) {
    setProspects(prospects.filter((p) => p.id !== id));
    await fetch(`/api/fundraising/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div>
      <div className="mb-5 grid grid-cols-3 gap-3">
        <Stat label="Committed" value={money(committed)} />
        <Stat label="Donated" value={money(donated)} />
        <Stat
          label={goal ? `of goal ${money(goal)}` : "No goal set"}
          value={goal ? `${Math.round((committed / goal) * 100)}%` : "—"}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-[var(--color-ink-subtle)]">
          {prospects.length} {prospects.length === 1 ? "donor" : "donors"}
        </p>
        <div className="flex gap-2">
          <a href="/fundraising/import" className="btn-secondary text-sm">Import from file</a>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary">
            {showForm ? "Cancel" : "Add donor"}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={add} className="card mb-5 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
          <input required placeholder="Full name *" value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} className="input" />
          <input placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className="input" />
          <input placeholder="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className="input" />
          <input placeholder="Employer" value={f.employer} onChange={(e) => setF({ ...f, employer: e.target.value })} className="input" />
          <input placeholder="Role / title" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} className="input" />
          <input type="number" placeholder="Est. capacity ($)" value={f.estimated_capacity} onChange={(e) => setF({ ...f, estimated_capacity: e.target.value })} className="input" />
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Prospect["status"] })} className="input">
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <textarea placeholder="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="input sm:col-span-2" rows={2} />
          <button type="submit" disabled={saving || !f.full_name.trim()} className="btn-primary sm:col-span-2">
            {saving ? "Saving..." : "Save prospect"}
          </button>
        </form>
      )}

      {prospects.length === 0 ? (
        <div className="card p-5 text-sm text-[var(--color-ink-subtle)]">
          No donors yet. Add prospective campaign donors to reach out to.
        </div>
      ) : (
        <ul className="space-y-2">
          {prospects.map((p) => (
            <li key={p.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-[var(--color-ink)]">{p.full_name}</div>
                  <div className="text-xs text-[var(--color-ink-subtle)]">
                    {[p.role, p.employer].filter(Boolean).join(" · ")}
                    {p.email ? ` · ${p.email}` : ""}
                    {p.phone ? ` · ${p.phone}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={p.status}
                    onChange={(e) => update(p.id, { status: e.target.value as Prospect["status"] })}
                    className="input !py-1 text-xs"
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <AIActionButton<AskDraft>
                    label="Draft ask"
                    className="btn-ghost text-xs"
                    endpoint={`/api/fundraising/${p.id}/draft-ask`}
                    resultKey="draft"
                    title={`Ask draft for ${p.full_name}`}
                    render={(d) => (
                      <div className="space-y-3">
                        <div className="flex items-baseline gap-2 text-xs text-[var(--color-ink-subtle)]">
                          <span className="chip chip-primary">{d.channel}</span>
                          <span className="chip chip-success">${d.suggested_amount}</span>
                        </div>
                        <p className="text-sm italic text-[var(--color-ink-muted)]">{d.rationale}</p>
                        {d.subject && (
                          <div>
                            <span className="section-label">Subject</span>
                            <CopyBox text={d.subject} />
                          </div>
                        )}
                        <div>
                          <span className="section-label">Body</span>
                          <CopyBox text={d.body} />
                        </div>
                      </div>
                    )}
                  />
                  <button onClick={() => del(p.id)} className="btn-ghost text-xs" title="Delete">Delete</button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <InlineNum label="Capacity" value={p.estimated_capacity} onCommit={(v) => update(p.id, { estimated_capacity: v })} />
                <InlineNum label="Asked" value={p.asked_amount} onCommit={(v) => update(p.id, { asked_amount: v })} />
                <InlineNum label="Committed" value={p.committed_amount} onCommit={(v) => update(p.id, { committed_amount: v })} />
                <InlineNum label="Donated" value={p.donated_amount} onCommit={(v) => update(p.id, { donated_amount: v })} />
              </div>
              {p.notes && <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{p.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-3 py-2">
      <div className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-ink-subtle)]">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-[var(--color-ink)]">{value}</div>
    </div>
  );
}

function InlineNum({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number | null;
  onCommit: (v: number | null) => void;
}) {
  const [v, setV] = useState(value?.toString() ?? "");
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-ink-subtle)]">{label}</span>
      <input
        type="number"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = v === "" ? null : parseFloat(v);
          if (n !== value) onCommit(Number.isNaN(n) ? null : n);
        }}
        className="input !py-1 text-xs"
      />
    </label>
  );
}

function money(n: number) {
  return "$" + Math.round(n).toLocaleString();
}
