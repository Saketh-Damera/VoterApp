"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import type { Ev, Attendee } from "./page";

type Match = {
  ncid: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  res_street_address: string | null;
  res_city: string | null;
  confidence: number;
};

type Brief = {
  headline: string;
  room_composition: string[];
  lead_with: string[];
  avoid: string[];
  specific_asks: { attendee_name: string; ask: string }[];
  open_with_line: string;
};

export default function EventDetailClient({
  event,
  initialAttendees,
}: {
  event: Ev;
  initialAttendees: Attendee[];
}) {
  const router = useRouter();
  const supabase = getSupabaseBrowser();
  const [attendees, setAttendees] = useState<Attendee[]>(initialAttendees);

  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [searching, setSearching] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const [generating, setGenerating] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(() => {
    if (!event.brief) return null;
    try {
      return JSON.parse(event.brief) as Brief;
    } catch {
      return null;
    }
  });
  const [briefErr, setBriefErr] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setMatches([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      const { data } = await supabase.rpc("match_voters", { q: term, max_results: 6 });
      setMatches((data as Match[]) ?? []);
      setSearching(false);
    }, 200);
    return () => clearTimeout(t);
  }, [q, supabase]);

  async function add(m: Match) {
    const res = await fetch(`/api/events/${event.id}/attendees`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ voter_ncid: m.ncid }),
    });
    const json = await res.json();
    if (!res.ok) return;
    if (json.ok) {
      setAttendees((cur) => [
        ...cur,
        {
          voter_ncid: m.ncid,
          first_name: m.first_name,
          last_name: m.last_name,
          res_city: m.res_city,
          party_cd: null,
        },
      ]);
    }
    setQ("");
    setMatches([]);
    router.refresh();
  }

  async function remove(ncid: string) {
    await fetch(`/api/events/${event.id}/attendees?voter_ncid=${encodeURIComponent(ncid)}`, { method: "DELETE" });
    setAttendees((cur) => cur.filter((a) => a.voter_ncid !== ncid));
    router.refresh();
  }

  async function genBrief() {
    setGenerating(true);
    setBriefErr(null);
    const res = await fetch(`/api/events/${event.id}/brief`, { method: "POST" });
    const json = await res.json();
    setGenerating(false);
    if (!res.ok) {
      setBriefErr(json.error ?? "failed");
      return;
    }
    setBrief(json.brief);
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">{event.title}</h1>
        <p className="text-sm text-[var(--color-ink-subtle)]">
          {event.event_date ? new Date(event.event_date).toLocaleString([], { dateStyle: "full", timeStyle: "short" }) : "no date set"}
          {event.location ? ` · ${event.location}` : ""}
        </p>
        {event.notes && (
          <p className="mt-2 text-sm italic text-[var(--color-ink-muted)]">Notes: {event.notes}</p>
        )}
      </header>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="section-label">Attendees ({attendees.length})</h2>
        </div>

        <div ref={boxRef} className="relative card p-3 mb-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Add attendee by name..."
            className="input"
          />
          {q.length >= 3 && (
            <div className="mt-2 border-t border-[var(--color-border)] pt-2 text-xs text-[var(--color-ink-subtle)]">
              {searching ? "Searching..." : matches.length ? `Top ${matches.length} matches` : "No matches"}
            </div>
          )}
          {matches.length > 0 && (
            <ul className="mt-1">
              {matches.map((m) => (
                <li key={m.ncid}>
                  <button
                    onClick={() => add(m)}
                    className="flex w-full items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-[var(--color-surface-muted)]"
                  >
                    <span className="text-sm">
                      <span className="font-medium">
                        {[m.first_name, m.middle_name, m.last_name].filter(Boolean).join(" ")}
                      </span>
                      <span className="ml-2 text-xs text-[var(--color-ink-subtle)]">
                        {m.res_street_address}{m.res_city ? ", " + m.res_city : ""}
                      </span>
                    </span>
                    <span className="font-mono text-xs text-[var(--color-ink-subtle)]">
                      {Math.round(m.confidence * 100)}%
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {attendees.length > 0 ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {attendees.map((a) => {
              const name = [a.first_name, a.last_name].filter(Boolean).join(" ") || "(no name)";
              return (
                <li key={a.voter_ncid} className="card flex items-baseline justify-between p-3">
                  <Link href={`/people/${a.voter_ncid}`} className="text-sm hover:text-[var(--color-primary)]">
                    <span className="font-medium">{name}</span>
                    <span className="ml-2 text-xs text-[var(--color-ink-subtle)]">
                      {a.res_city ?? ""}{a.party_cd ? " · " + a.party_cd : ""}
                    </span>
                  </Link>
                  <button onClick={() => remove(a.voter_ncid)} className="btn-ghost text-xs">Remove</button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-[var(--color-ink-subtle)]">Add attendees above to generate a brief.</p>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="section-label">Pre-event brief</h2>
          <button
            onClick={genBrief}
            disabled={generating || attendees.length === 0}
            className="btn-primary text-sm"
          >
            {generating
              ? "Claude drafting..."
              : brief
              ? "Regenerate"
              : "Generate brief"}
          </button>
        </div>

        {briefErr && (
          <div className="card bg-[var(--color-danger-soft)] p-3 text-sm text-[var(--color-danger)]">
            {briefErr}
          </div>
        )}

        {!brief && !briefErr && (
          <div className="card p-5 text-sm text-[var(--color-ink-subtle)]">
            Add the attendees you expect, then click <strong>Generate brief</strong>. You'll get a one-pager:
            room composition, what to lead with, what to avoid, specific asks, and an opening line.
          </div>
        )}

        {brief && (
          <div className="card space-y-4 p-5 text-sm">
            <p className="text-base font-medium text-[var(--color-ink)]">{brief.headline}</p>

            <div className="rounded-md border border-[var(--color-accent-soft)] bg-[var(--color-accent-soft)] p-3">
              <div className="section-label mb-1">Open with</div>
              <p className="text-[var(--color-primary)]">{brief.open_with_line}</p>
            </div>

            <div>
              <h3 className="section-label mb-1">Room composition</h3>
              <ul className="list-disc pl-5 text-[var(--color-ink-muted)]">
                {brief.room_composition.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </div>

            <div>
              <h3 className="section-label mb-1">Lead with</h3>
              <ul className="list-disc pl-5 text-[var(--color-ink-muted)]">
                {brief.lead_with.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </div>

            {brief.avoid.length > 0 && (
              <div>
                <h3 className="section-label mb-1">Avoid</h3>
                <ul className="list-disc pl-5 text-[var(--color-ink-muted)]">
                  {brief.avoid.map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              </div>
            )}

            {brief.specific_asks.length > 0 && (
              <div>
                <h3 className="section-label mb-1">Specific asks</h3>
                <ul className="space-y-2">
                  {brief.specific_asks.map((a, i) => (
                    <li key={i} className="rounded-md border border-[var(--color-border)] p-2 text-sm">
                      <span className="font-medium">{a.attendee_name}</span>: {a.ask}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
