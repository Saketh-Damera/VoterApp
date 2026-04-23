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
  const [q, setQ] = useState("");
  const [party, setParty] = useState<string>("");
  const [sentiment, setSentiment] = useState<string>("");
  const raceLabel = raceLabelFor(raceType);

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
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <label className="flex flex-1 min-w-[220px] flex-col gap-1">
          <span className="section-label">Search</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="name, address, issue, tag..."
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
          {initial.length === 0 ? "No conversations logged yet." : "No matches."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-[0.08em] text-[var(--color-ink-subtle)]">
              <tr className="border-b border-[var(--color-border)]">
                <th className="py-2 pr-3 font-semibold">Name</th>
                <th className="py-2 pr-3 font-semibold hidden md:table-cell">Address</th>
                <th className="py-2 pr-3 font-semibold">Party</th>
                <th className="py-2 pr-3 font-semibold">Sentiment</th>
                <th className="py-2 pr-3 font-semibold">Turnout</th>
                <th className="py-2 font-semibold hidden sm:table-cell">Last</th>
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
                    <td className="py-3 pr-3 text-xs text-[var(--color-ink-muted)] hidden md:table-cell">
                      {p.res_street_address}{p.res_city ? ", " + p.res_city : ""}
                    </td>
                    <td className="py-3 pr-3 text-xs">{p.party_cd ?? "—"}</td>
                    <td className="py-3 pr-3 text-xs">
                      {p.last_sentiment ? (
                        <span className={`chip ${sentimentChip(p.last_sentiment)}`}>
                          {p.last_sentiment.replace(/_/g, " ")}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="py-3 pr-3 text-xs">
                      <span className={`chip ${tag.chipClass}`}>{tag.text}</span>
                    </td>
                    <td className="py-3 text-xs text-[var(--color-ink-subtle)] hidden sm:table-cell">
                      {new Date(p.last_contact).toLocaleDateString()}
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
