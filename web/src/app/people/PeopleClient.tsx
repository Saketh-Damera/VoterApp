"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { TalkedTo } from "./page";

const SENTIMENTS = ["supportive", "leaning_supportive", "undecided", "leaning_opposed", "opposed", "unknown"];

export default function PeopleClient({ initial }: { initial: TalkedTo[] }) {
  const [q, setQ] = useState("");
  const [party, setParty] = useState<string>("");
  const [sentiment, setSentiment] = useState<string>("");

  const parties = useMemo(() => {
    return Array.from(new Set(initial.map((p) => p.party_cd).filter(Boolean))) as string[];
  }, [initial]);

  const filtered = useMemo(() => {
    const term = q.toLowerCase().trim();
    return initial.filter((p) => {
      if (party && p.party_cd !== party) return false;
      if (sentiment && p.last_sentiment !== sentiment) return false;
      if (!term) return true;
      const hay = [p.first_name, p.last_name, p.res_street_address, p.res_city, ...(p.last_issues ?? []), ...(p.last_tags ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(term);
    });
  }, [initial, q, party, sentiment]);

  return (
    <div>
      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-ink-subtle)]">Search</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="name, address, issue, tag..."
            className="input"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-ink-subtle)]">Party</span>
          <select value={party} onChange={(e) => setParty(e.target.value)} className="input !py-2">
            <option value="">All</option>
            {parties.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-ink-subtle)]">Sentiment</span>
          <select value={sentiment} onChange={(e) => setSentiment(e.target.value)} className="input !py-2">
            <option value="">All</option>
            {SENTIMENTS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-5 text-sm text-[var(--color-ink-subtle)]">
          {initial.length === 0 ? "No interactions yet." : "No matches."}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-muted)] text-left text-xs text-[var(--color-ink-subtle)]">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium hidden md:table-cell">Address</th>
                <th className="px-3 py-2 font-medium">Party</th>
                <th className="px-3 py-2 font-medium">Sentiment</th>
                <th className="px-3 py-2 font-medium hidden sm:table-cell">Last</th>
                <th className="px-3 py-2 font-medium text-right">Pri.</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || "(no name)";
                return (
                  <tr key={p.voter_ncid} className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]">
                    <td className="px-3 py-2">
                      <Link href={`/people/${p.voter_ncid}`} className="font-medium hover:text-[var(--color-primary)]">
                        {name}
                      </Link>
                      {p.interaction_count > 1 && (
                        <span className="ml-1 text-xs text-[var(--color-ink-subtle)]">×{p.interaction_count}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-ink-muted)] hidden md:table-cell">
                      {p.res_street_address}{p.res_city ? ", " + p.res_city : ""}
                    </td>
                    <td className="px-3 py-2 text-xs">{p.party_cd ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {p.last_sentiment ? (
                        <span className={`chip ${sentimentChip(p.last_sentiment)}`}>
                          {p.last_sentiment.replace(/_/g, " ")}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--color-ink-subtle)] hidden sm:table-cell">
                      {new Date(p.last_contact).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {p.priority !== null && (
                        <span className={`chip ${priorityChip(Number(p.priority))}`}>
                          {Math.round(Number(p.priority))}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function sentimentChip(s: string): string {
  switch (s) {
    case "supportive":
    case "leaning_supportive":
      return "chip-success";
    case "opposed":
    case "leaning_opposed":
      return "chip-danger";
    case "undecided":
      return "chip-warning";
    default:
      return "chip-neutral";
  }
}
function priorityChip(p: number): string {
  if (p >= 50) return "chip-danger";
  if (p >= 25) return "chip-warning";
  if (p >= 10) return "chip-primary";
  return "chip-neutral";
}
