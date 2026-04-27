"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { TalkedTo } from "./page";
import { sentimentChip } from "@/lib/ui/chips";
import { voteTag, raceLabelFor } from "@/lib/ui/voteTag";

const SENTIMENTS = ["supportive", "leaning_supportive", "undecided", "leaning_opposed", "opposed", "unknown"];

export default function PeopleClient({
  initial,
  raceType,
}: {
  initial: TalkedTo[];
  raceType: string | null;
}) {
  const [rows, setRows] = useState<TalkedTo[]>(initial);
  const [q, setQ] = useState("");
  const [party, setParty] = useState("");
  const [sentiment, setSentiment] = useState("");
  const [editing, setEditing] = useState<TalkedTo | null>(null);
  const raceLabel = raceLabelFor(raceType);

  const parties = useMemo(
    () => Array.from(new Set(rows.map((p) => p.party_cd).filter(Boolean))) as string[],
    [rows],
  );

  const filtered = useMemo(() => {
    const term = q.toLowerCase().trim();
    return rows.filter((p) => {
      if (party && p.party_cd !== party) return false;
      if (sentiment && p.last_sentiment !== sentiment) return false;
      if (!term) return true;
      const hay = [
        p.first_name, p.last_name, p.res_street_address, p.res_city,
        p.last_notes,
        ...(p.last_issues ?? []), ...(p.last_tags ?? []),
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(term);
    });
  }, [rows, q, party, sentiment]);

  async function patchInteraction(id: string, patch: Record<string, unknown>) {
    const res = await fetch(`/api/interactions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error ?? "save failed");
    }
  }

  async function changeSentiment(row: TalkedTo, value: string) {
    const next = value || null;
    setRows((cur) =>
      cur.map((r) => (r.voter_ncid === row.voter_ncid ? { ...r, last_sentiment: next } : r)),
    );
    try {
      await patchInteraction(row.last_interaction_id, { sentiment: next });
    } catch {
      // revert
      setRows((cur) =>
        cur.map((r) =>
          r.voter_ncid === row.voter_ncid ? { ...r, last_sentiment: row.last_sentiment } : r,
        ),
      );
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <label className="flex flex-1 min-w-[220px] flex-col gap-1">
          <span className="section-label">Search</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="name, address, notes, issue, tag..."
            className="input"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="section-label">Party</span>
          <select value={party} onChange={(e) => setParty(e.target.value)} className="input !py-2">
            <option value="">All</option>
            {parties.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="section-label">Sentiment</span>
          <select value={sentiment} onChange={(e) => setSentiment(e.target.value)} className="input !py-2">
            <option value="">All</option>
            {SENTIMENTS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-subtle)]">
          {rows.length === 0 ? "No conversations logged yet." : "No matches."}
        </p>
      ) : (
        <>
          {/* Mobile: card list */}
          <ul className="space-y-3 md:hidden">
            {filtered.map((p) => {
              const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || "(no name)";
              const tag = voteTag(p.relevant_votes, p.total_votes, raceLabel);
              return (
                <li key={p.voter_ncid} className="card p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link href={`/people/${p.voter_ncid}`} className="font-medium text-base hover:text-[var(--color-primary)]">
                      {name}
                    </Link>
                    <span className="shrink-0 text-xs text-[var(--color-ink-subtle)]">
                      {new Date(p.last_contact).toLocaleDateString()}
                    </span>
                  </div>
                  {(p.res_street_address || p.res_city) && (
                    <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">
                      {p.res_street_address}{p.res_city ? ", " + p.res_city : ""}
                      {p.party_cd ? ` · ${p.party_cd}` : ""}
                    </p>
                  )}
                  {p.last_notes && (
                    <p className="mt-2 line-clamp-3 text-sm text-[var(--color-ink-muted)]">{p.last_notes}</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select
                      value={p.last_sentiment ?? ""}
                      onChange={(e) => changeSentiment(p, e.target.value)}
                      className="input !px-3 !py-2 text-sm"
                    >
                      <option value="">— sentiment —</option>
                      {SENTIMENTS.map((s) => (
                        <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                    <span className={`chip ${tag.chipClass}`}>{tag.text}</span>
                    {p.interaction_count > 1 && (
                      <span className="text-xs text-[var(--color-ink-subtle)]">{p.interaction_count} talks</span>
                    )}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => setEditing(p)} className="btn-secondary text-sm flex-1">
                      Edit
                    </button>
                    <Link href={`/people/${p.voter_ncid}`} className="btn-ghost text-sm">
                      Open
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Desktop: table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-[0.08em] text-[var(--color-ink-subtle)]">
                <tr className="border-b border-[var(--color-border)]">
                  <th className="py-2 pr-3 font-semibold">Name</th>
                  <th className="py-2 pr-3 font-semibold">Address</th>
                  <th className="py-2 pr-3 font-semibold">Party</th>
                  <th className="py-2 pr-3 font-semibold">Sentiment</th>
                  <th className="py-2 pr-3 font-semibold">Turnout</th>
                  <th className="py-2 pr-3 font-semibold hidden lg:table-cell">Notes</th>
                  <th className="py-2 pr-3 font-semibold whitespace-nowrap">Last</th>
                  <th className="py-2 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || "(no name)";
                  const tag = voteTag(p.relevant_votes, p.total_votes, raceLabel);
                  return (
                    <tr key={p.voter_ncid} className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]">
                      <td className="py-3 pr-3">
                        <Link href={`/people/${p.voter_ncid}`} className="font-medium hover:text-[var(--color-primary)]">
                          {name}
                        </Link>
                        {p.interaction_count > 1 && (
                          <span className="ml-2 text-xs text-[var(--color-ink-subtle)]">×{p.interaction_count}</span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-xs text-[var(--color-ink-muted)]">
                        {p.res_street_address}{p.res_city ? ", " + p.res_city : ""}
                      </td>
                      <td className="py-3 pr-3 text-xs">{p.party_cd ?? "—"}</td>
                      <td className="py-3 pr-3 text-xs">
                        <select
                          value={p.last_sentiment ?? ""}
                          onChange={(e) => changeSentiment(p, e.target.value)}
                          className="input !px-2 !py-1 text-xs w-full max-w-[10rem]"
                        >
                          <option value="">—</option>
                          {SENTIMENTS.map((s) => (
                            <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 pr-3 text-xs">
                        <span className={`chip ${tag.chipClass}`}>{tag.text}</span>
                      </td>
                      <td className="py-3 pr-3 text-xs text-[var(--color-ink-muted)] hidden lg:table-cell max-w-[24rem]">
                        <span className="line-clamp-2">{p.last_notes ?? "—"}</span>
                      </td>
                      <td className="py-3 pr-3 text-xs text-[var(--color-ink-subtle)] whitespace-nowrap">
                        {new Date(p.last_contact).toLocaleDateString()}
                      </td>
                      <td className="py-3">
                        <button onClick={() => setEditing(p)} className="btn-ghost text-xs">
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && (
        <EditModal
          row={editing}
          onClose={() => setEditing(null)}
          onSave={(updated) => {
            setRows((cur) =>
              cur.map((r) => (r.voter_ncid === updated.voter_ncid ? { ...r, ...updated } : r)),
            );
            setEditing(null);
          }}
          patchInteraction={patchInteraction}
        />
      )}
    </div>
  );
}

function EditModal({
  row,
  onClose,
  onSave,
  patchInteraction,
}: {
  row: TalkedTo;
  onClose: () => void;
  onSave: (updated: Partial<TalkedTo> & { voter_ncid: string }) => void;
  patchInteraction: (id: string, patch: Record<string, unknown>) => Promise<void>;
}) {
  const [notes, setNotes] = useState(row.last_notes ?? "");
  const [sentiment, setSentiment] = useState(row.last_sentiment ?? "");
  const [issues, setIssues] = useState((row.last_issues ?? []).join(", "));
  const [tags, setTags] = useState((row.last_tags ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const issuesArr = issues.split(",").map((s) => s.trim()).filter(Boolean);
      const tagsArr = tags.split(",").map((s) => s.trim()).filter(Boolean);
      await patchInteraction(row.last_interaction_id, {
        notes,
        sentiment: sentiment || null,
        issues: issuesArr,
        tags: tagsArr,
      });
      onSave({
        voter_ncid: row.voter_ncid,
        last_notes: notes,
        last_sentiment: sentiment || null,
        last_issues: issuesArr,
        last_tags: tagsArr,
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const name = [row.first_name, row.last_name].filter(Boolean).join(" ") || "(no name)";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-base font-semibold">{name}</h3>
          <button onClick={onClose} className="btn-ghost text-xs">Close</button>
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="section-label">Sentiment</span>
            <select
              value={sentiment}
              onChange={(e) => setSentiment(e.target.value)}
              className="input mt-1"
            >
              <option value="">—</option>
              {SENTIMENTS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="section-label">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="input mt-1"
            />
          </label>
          <label className="block">
            <span className="section-label">Issues</span>
            <input
              value={issues}
              onChange={(e) => setIssues(e.target.value)}
              className="input mt-1"
              placeholder="comma-separated, e.g. property-taxes, rezoning"
            />
          </label>
          <label className="block">
            <span className="section-label">Tags</span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="input mt-1"
              placeholder="comma-separated, e.g. teacher, parent"
            />
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? "Saving..." : "Save"}
          </button>
          {err && <span className="text-sm text-[var(--color-danger)]">{err}</span>}
        </div>
      </div>
    </div>
  );
}
