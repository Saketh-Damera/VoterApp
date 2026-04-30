"use client";

import { useState } from "react";
import type { ListMeta } from "./page";

type CohortRow = {
  ncid: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  res_street_address: string | null;
  res_city: string | null;
  res_zip: string | null;
  party_cd: string | null;
  age: number | null;
  phone: string | null;
  email: string | null;
  precinct_desc: string | null;
};

type Filter = Record<string, unknown>;

const SUGGESTIONS = [
  "Democrats in Tenafly under age 40",
  "Voters who voted in the 2024 primary, Democratic ballot",
  "Independents in Ward 2 who have voted at least 3 times",
  "Active voters age 65+ in the school district",
];

export default function CohortClient({ lists }: { lists: ListMeta[] }) {
  const [description, setDescription] = useState("");
  const [listId, setListId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [voters, setVoters] = useState<CohortRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  async function build() {
    setLoading(true);
    setErr(null);
    setVoters(null);
    setFilter(null);
    try {
      const res = await fetch("/api/cohorts/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description,
          list_id: listId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "build failed");
      } else {
        setFilter(json.filter as Filter);
        setVoters(json.voters as CohortRow[]);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function exportXlsx() {
    if (!filter) return;
    setExporting(true);
    setErr(null);
    try {
      const res = await fetch("/api/cohorts/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filter,
          list_id: listId || null,
          filename: description.slice(0, 60) || "cohort",
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        setErr(txt.slice(0, 200));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("content-disposition") ?? "";
      const m = cd.match(/filename="([^"]+)"/);
      a.download = m?.[1] ?? `cohort-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <label className="block">
          <span className="section-label">Describe the cohort</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="e.g. Democrats in Tenafly who voted in the 2024 primary, age 25-55"
            className="input mt-1"
          />
        </label>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="section-label">Restrict to one list (optional)</span>
            <select
              value={listId}
              onChange={(e) => setListId(e.target.value)}
              className="input !py-2 max-w-[20rem]"
            >
              <option value="">All my lists</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.city || l.state ? ` · ${[l.city, l.state].filter(Boolean).join(", ")}` : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={build}
            disabled={loading || description.trim().length < 3}
            className="btn-primary"
          >
            {loading ? "Translating + matching..." : "Build cohort"}
          </button>
        </div>

        {!voters && !loading && (
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setDescription(s)}
                className="chip chip-neutral cursor-pointer hover:bg-[var(--color-surface-muted)]"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {err && (
        <div className="card bg-[var(--color-danger-soft)] p-3 text-sm text-[var(--color-danger)]">
          {err}
        </div>
      )}

      {filter && (
        <div className="card p-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="section-label">Filter JED used</span>
            <span className="text-xs text-[var(--color-ink-subtle)]">
              {voters?.length ?? 0} match{voters?.length === 1 ? "" : "es"}
            </span>
          </div>
          <pre className="overflow-auto rounded bg-[var(--color-surface-muted)] p-2 text-xs">
            {JSON.stringify(filter, null, 2)}
          </pre>
          <div className="mt-3 flex gap-2">
            <button
              onClick={exportXlsx}
              disabled={exporting || !voters?.length}
              className="btn-primary text-sm"
            >
              {exporting ? "Building XLSX..." : "Download XLSX"}
            </button>
          </div>
        </div>
      )}

      {voters && voters.length > 0 && (
        <div className="card p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-[0.08em] text-[var(--color-ink-subtle)]">
                <tr className="border-b border-[var(--color-border)]">
                  <th className="py-2 pr-3 font-semibold">Name</th>
                  <th className="py-2 pr-3 font-semibold">Address</th>
                  <th className="py-2 pr-3 font-semibold">City</th>
                  <th className="py-2 pr-3 font-semibold">Party</th>
                  <th className="py-2 pr-3 font-semibold">Age</th>
                  <th className="py-2 pr-3 font-semibold">Phone</th>
                  <th className="py-2 pr-3 font-semibold">Email</th>
                </tr>
              </thead>
              <tbody>
                {voters.slice(0, 200).map((v) => (
                  <tr
                    key={v.ncid}
                    className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
                  >
                    <td className="py-2 pr-3">
                      <a
                        href={`/people/${v.ncid}`}
                        className="font-medium hover:text-[var(--color-primary)]"
                      >
                        {[v.first_name, v.last_name].filter(Boolean).join(" ")}
                      </a>
                    </td>
                    <td className="py-2 pr-3 text-xs text-[var(--color-ink-muted)]">
                      {v.res_street_address}
                    </td>
                    <td className="py-2 pr-3 text-xs">{v.res_city ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs">{v.party_cd ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs">{v.age ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs">{v.phone ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs truncate max-w-[14rem]">
                      {v.email ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {voters.length > 200 && (
            <p className="mt-2 text-xs text-[var(--color-ink-subtle)]">
              Showing first 200 of {voters.length}. Download XLSX to get the full list.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
