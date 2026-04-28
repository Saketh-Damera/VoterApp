"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import JedLogo from "./JedLogo";

const SUGGESTIONS = [
  "Show me everyone I talked to last week.",
  "Find conversations that mentioned schools.",
  "Who at the PTA meeting cared about traffic?",
  "List voters in Ward 2 I've spoken to.",
];

type VoterHit = {
  name: string;
  address: string | null;
  city: string | null;
  party: string | null;
  birth_year: number | null;
  ncid: string;
  already_contacted: boolean;
};

type AskResult = {
  answer: string;
  voter_lookup: VoterHit[];
};

export default function AskJedCard() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [addedNcids, setAddedNcids] = useState<Set<string>>(new Set());
  const [addingNcid, setAddingNcid] = useState<string | null>(null);
  const [bulkAdding, setBulkAdding] = useState(false);

  async function ask(question: string) {
    const body = question.trim();
    if (!body) return;
    setLoading(true);
    setErr(null);
    setResult(null);
    setAddedNcids(new Set());
    try {
      const res = await fetch("/api/ask-jed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: body }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "failed");
      } else {
        setResult({
          answer: json.answer ?? "(empty response)",
          voter_lookup: (json.voter_lookup as VoterHit[]) ?? [],
        });
      }
    } finally {
      setLoading(false);
    }
  }

  async function addToContacts(v: VoterHit, source: string) {
    setAddingNcid(v.ncid);
    try {
      const res = await fetch("/api/interactions/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          captured_name: v.name,
          captured_location: source,
          notes: null,
          voter_ncid: v.ncid,
          match_confidence: 1.0,
        }),
      });
      if (res.ok) {
        setAddedNcids((prev) => new Set(prev).add(v.ncid));
        router.refresh();
      } else {
        const json = await res.json().catch(() => ({}));
        setErr(json.error ?? "couldn't add");
      }
    } finally {
      setAddingNcid(null);
    }
  }

  async function addAllUncontacted() {
    if (!result) return;
    setBulkAdding(true);
    const targets = result.voter_lookup.filter(
      (v) => !v.already_contacted && !addedNcids.has(v.ncid),
    );
    const source = `From JED: "${q.slice(0, 80)}"`;
    for (const v of targets) {
      try {
        const res = await fetch("/api/interactions/manual", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            captured_name: v.name,
            captured_location: source,
            notes: null,
            voter_ncid: v.ncid,
            match_confidence: 1.0,
          }),
        });
        if (res.ok) {
          setAddedNcids((prev) => {
            const next = new Set(prev);
            next.add(v.ncid);
            return next;
          });
        }
      } catch {
        // continue with the rest
      }
    }
    setBulkAdding(false);
    router.refresh();
  }

  const matches = result?.voter_lookup ?? [];
  const addableCount = matches.filter(
    (v) => !v.already_contacted && !addedNcids.has(v.ncid),
  ).length;

  return (
    <section className="card mb-10 p-5">
      <div className="mb-3 flex items-center gap-3">
        <JedLogo size="sm" href="" />
        <span className="text-sm text-[var(--color-ink-subtle)]">
          Search your campaign data — names, conversations, issues, places.
        </span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. Find conversations that mentioned schools"
          className="input flex-1"
          disabled={loading}
        />
        <button type="submit" disabled={loading || !q.trim()} className="btn-primary">
          {loading ? "Thinking..." : "Ask"}
        </button>
      </form>

      {!result && !loading && !err && (
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => { setQ(s); ask(s); }}
              className="chip chip-neutral cursor-pointer hover:bg-[var(--color-surface-muted)]"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {err && (
        <p className="mt-3 rounded-md bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {err}
        </p>
      )}

      {result && (
        <div className="mt-4 space-y-3">
          <div className="whitespace-pre-wrap rounded-md bg-[var(--color-surface-muted)] px-4 py-3 text-sm leading-relaxed text-[var(--color-ink)]">
            {result.answer}
          </div>

          {matches.length > 0 && (
            <div className="rounded-md border border-[var(--color-border)] p-3">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="section-label">
                  Voters JED found ({matches.length})
                </span>
                {addableCount > 1 && (
                  <button
                    onClick={addAllUncontacted}
                    disabled={bulkAdding}
                    className="btn-ghost text-xs"
                  >
                    {bulkAdding ? "Adding..." : `Add all ${addableCount} to contacts`}
                  </button>
                )}
              </div>
              <ul className="space-y-1.5">
                {matches.map((v) => {
                  const added = addedNcids.has(v.ncid);
                  const inContacts = v.already_contacted || added;
                  const adding = addingNcid === v.ncid;
                  const source = `From JED: "${q.slice(0, 80)}"`;
                  return (
                    <li
                      key={v.ncid}
                      className="flex items-baseline justify-between gap-2 rounded-md bg-[var(--color-surface)] px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="font-medium">{v.name}</div>
                        <div className="text-xs text-[var(--color-ink-subtle)] truncate">
                          {v.address}
                          {v.city ? ", " + v.city : ""}
                          {v.party ? ` · ${v.party}` : ""}
                          {v.birth_year ? ` · b. ${v.birth_year}` : ""}
                        </div>
                      </div>
                      {inContacts ? (
                        <span className="chip chip-success shrink-0">
                          {added ? "Added" : "In contacts"}
                        </span>
                      ) : (
                        <button
                          onClick={() => addToContacts(v, source)}
                          disabled={adding || bulkAdding}
                          className="btn-secondary shrink-0 text-xs"
                        >
                          {adding ? "Adding..." : "Add to contacts"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => { setResult(null); setQ(""); setAddedNcids(new Set()); }}
              className="btn-ghost text-xs"
            >
              Ask another
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
