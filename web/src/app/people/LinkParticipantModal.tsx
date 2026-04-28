"use client";

import { useEffect, useState } from "react";
import type { TalkedTo } from "./page";

type SearchHit = {
  ncid: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  res_street_address: string | null;
  res_city: string | null;
  party_cd?: string | null;
  match_count?: number;
  why?: string;
};

type Tab = "search" | "ask_jed" | "manual";

export default function LinkParticipantModal({
  row,
  onClose,
  onLinked,
}: {
  row: TalkedTo;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [tab, setTab] = useState<Tab>("search");
  const [linking, setLinking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // search tab
  const [query, setQuery] = useState(row.captured_name ?? "");
  const [searching, setSearching] = useState(false);
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);

  // ask_jed tab
  const [thinking, setThinking] = useState(false);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [aiHits, setAiHits] = useState<SearchHit[]>([]);
  const [aiPool, setAiPool] = useState<SearchHit[]>([]);

  // manual tab
  const [manual, setManual] = useState({
    first_name: row.captured_name?.split(" ")[0] ?? "",
    last_name: row.captured_name?.split(" ").slice(1).join(" ") ?? "",
    res_street_address: "",
    res_city: "",
    res_zip: "",
    party_cd: "",
    birth_year: "",
  });

  useEffect(() => {
    runSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSearch(q: string) {
    if (!q.trim()) { setSearchHits([]); return; }
    setSearching(true);
    try {
      // Reuse find_voters_by_name through a tiny helper RPC by calling the
      // ask-jed style endpoint via the participant's suggest-matches without
      // ranking. Simpler: hit a thin /api/voters/search route. For now we
      // fetch from /api/participants/suggest because it returns the pool.
      const res = await fetch(`/api/participants/${row.last_participant_id}/suggest-matches`, {
        method: "POST",
      });
      const json = await res.json();
      if (res.ok) {
        setSearchHits((json.pool as SearchHit[]) ?? []);
      } else {
        setErr(json.error ?? "search failed");
      }
    } finally {
      setSearching(false);
    }
  }

  async function askJed() {
    setThinking(true);
    setErr(null);
    setAiHits([]);
    setAiPool([]);
    setReasoning(null);
    try {
      const res = await fetch(`/api/participants/${row.last_participant_id}/suggest-matches`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "request failed");
      setReasoning(json.reasoning ?? null);
      setAiHits((json.candidates as SearchHit[]) ?? []);
      setAiPool((json.pool as SearchHit[]) ?? []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setThinking(false);
    }
  }

  async function pickVoter(ncid: string) {
    setLinking(true);
    setErr(null);
    try {
      const res = await fetch(`/api/participants/${row.last_participant_id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ voter_ncid: ncid }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "link failed");
      onLinked();
    } catch (e) {
      setErr((e as Error).message);
      setLinking(false);
    }
  }

  async function createManual() {
    setLinking(true);
    setErr(null);
    try {
      const payload = {
        first_name: manual.first_name.trim() || null,
        last_name: manual.last_name.trim() || null,
        res_street_address: manual.res_street_address.trim() || null,
        res_city: manual.res_city.trim() || null,
        res_zip: manual.res_zip.trim() || null,
        party_cd: manual.party_cd.trim() || null,
        birth_year: manual.birth_year ? parseInt(manual.birth_year, 10) : null,
      };
      const res = await fetch(`/api/participants/${row.last_participant_id}/create-voter`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "create failed");
      onLinked();
    } catch (e) {
      setErr((e as Error).message);
      setLinking(false);
    }
  }

  function renderHit(h: SearchHit) {
    const name = [h.first_name, h.middle_name, h.last_name].filter(Boolean).join(" ");
    return (
      <li
        key={h.ncid}
        className="flex items-baseline justify-between gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
      >
        <div className="min-w-0">
          <div className="font-medium">{name}</div>
          <div className="text-xs text-[var(--color-ink-subtle)] truncate">
            {h.res_street_address}{h.res_city ? ", " + h.res_city : ""}
            {h.party_cd ? ` · ${h.party_cd}` : ""}
          </div>
          {h.why && (
            <div className="mt-1 text-xs text-[var(--color-ink-muted)] italic">{h.why}</div>
          )}
        </div>
        <button
          onClick={() => pickVoter(h.ncid)}
          disabled={linking}
          className="btn-secondary text-xs shrink-0"
        >
          Link
        </button>
      </li>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-2xl max-h-[85vh] flex flex-col p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-base font-semibold">
            Link &ldquo;{row.captured_name ?? "this person"}&rdquo;
          </h3>
          <button onClick={onClose} className="btn-ghost text-xs">Close</button>
        </div>

        <div className="mb-3 flex gap-1 border-b border-[var(--color-border)]">
          <TabBtn active={tab === "search"} onClick={() => setTab("search")}>Search voter file</TabBtn>
          <TabBtn active={tab === "ask_jed"} onClick={() => { setTab("ask_jed"); if (!aiHits.length) askJed(); }}>Ask JED</TabBtn>
          <TabBtn active={tab === "manual"} onClick={() => setTab("manual")}>Add manually</TabBtn>
        </div>

        <div className="flex-1 overflow-auto">
          {tab === "search" && (
            <div className="space-y-3">
              <label className="block">
                <span className="section-label">Search by name</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runSearch(query)}
                  className="input mt-1"
                  placeholder="Try a first name, last name, or partial spelling"
                />
              </label>
              <button onClick={() => runSearch(query)} disabled={searching} className="btn-secondary text-xs">
                {searching ? "Searching..." : "Search"}
              </button>
              {searchHits.length > 0 ? (
                <ul className="space-y-2">{searchHits.map(renderHit)}</ul>
              ) : !searching ? (
                <p className="text-sm text-[var(--color-ink-subtle)]">
                  Nothing in your lists matches yet. Try a different spelling, or use Ask JED / Add manually.
                </p>
              ) : null}
            </div>
          )}

          {tab === "ask_jed" && (
            <div className="space-y-3">
              <button onClick={askJed} disabled={thinking} className="btn-secondary text-xs">
                {thinking ? "JED is looking..." : "Ask JED who this might be"}
              </button>
              {reasoning && (
                <p className="text-sm text-[var(--color-ink-muted)] italic">{reasoning}</p>
              )}
              {aiHits.length > 0 && (
                <ul className="space-y-2">{aiHits.map(renderHit)}</ul>
              )}
              {!thinking && aiHits.length === 0 && reasoning && (
                <p className="text-sm text-[var(--color-ink-subtle)]">
                  JED could not narrow it down. Use Search voter file or Add manually instead.
                </p>
              )}
              {aiPool.length > 0 && (
                <details className="text-xs text-[var(--color-ink-subtle)]">
                  <summary className="cursor-pointer">See full candidate pool ({aiPool.length})</summary>
                  <ul className="mt-2 space-y-2">{aiPool.map(renderHit)}</ul>
                </details>
              )}
            </div>
          )}

          {tab === "manual" && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--color-ink-subtle)]">
                Creates a new voter row in your private &ldquo;Manual entries&rdquo; list and links this person to it.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="section-label">First name</span>
                  <input
                    value={manual.first_name}
                    onChange={(e) => setManual({ ...manual, first_name: e.target.value })}
                    className="input mt-1"
                  />
                </label>
                <label className="block">
                  <span className="section-label">Last name</span>
                  <input
                    value={manual.last_name}
                    onChange={(e) => setManual({ ...manual, last_name: e.target.value })}
                    className="input mt-1"
                  />
                </label>
              </div>
              <label className="block">
                <span className="section-label">Address</span>
                <input
                  value={manual.res_street_address}
                  onChange={(e) => setManual({ ...manual, res_street_address: e.target.value })}
                  className="input mt-1"
                />
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label className="block col-span-2">
                  <span className="section-label">City</span>
                  <input
                    value={manual.res_city}
                    onChange={(e) => setManual({ ...manual, res_city: e.target.value })}
                    className="input mt-1"
                  />
                </label>
                <label className="block">
                  <span className="section-label">ZIP</span>
                  <input
                    value={manual.res_zip}
                    onChange={(e) => setManual({ ...manual, res_zip: e.target.value })}
                    className="input mt-1"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="section-label">Party</span>
                  <input
                    value={manual.party_cd}
                    onChange={(e) => setManual({ ...manual, party_cd: e.target.value })}
                    className="input mt-1"
                    placeholder="DEM / REP / UNA"
                  />
                </label>
                <label className="block">
                  <span className="section-label">Birth year</span>
                  <input
                    value={manual.birth_year}
                    onChange={(e) => setManual({ ...manual, birth_year: e.target.value })}
                    className="input mt-1"
                    inputMode="numeric"
                    placeholder="1965"
                  />
                </label>
              </div>
              <button
                onClick={createManual}
                disabled={linking || (!manual.first_name.trim() && !manual.last_name.trim())}
                className="btn-primary"
              >
                {linking ? "Saving..." : "Create voter and link"}
              </button>
            </div>
          )}
        </div>

        {err && <p className="mt-3 text-sm text-[var(--color-danger)]">{err}</p>}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm border-b-2 transition ${
        active
          ? "border-[var(--color-primary)] text-[var(--color-primary)] font-semibold"
          : "border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
      }`}
    >
      {children}
    </button>
  );
}
