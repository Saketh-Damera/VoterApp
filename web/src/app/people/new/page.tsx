"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

type Match = {
  ncid: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  res_street_address: string | null;
  res_city: string | null;
  party_cd: string | null;
  birth_year: number | null;
  precinct_desc: string | null;
  confidence: number;
};

export default function NewPersonPage() {
  const router = useRouter();
  const supabase = getSupabaseBrowser();

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [picked, setPicked] = useState<Match | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const q = name.trim();
    if (q.length < 3) {
      setMatches([]);
      return;
    }
    if (picked && q === fullName(picked)) return;
    const t = setTimeout(async () => {
      setSearching(true);
      const { data, error } = await supabase.rpc("match_voters", { q, max_results: 8 });
      setSearching(false);
      if (error) {
        setErr(error.message);
        return;
      }
      setMatches((data as Match[]) ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [name, picked, supabase]);

  async function save() {
    setSaving(true);
    setErr(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setErr("Not signed in");
      setSaving(false);
      return;
    }
    const { data: inserted, error } = await supabase
      .from("interactions")
      .insert({
        user_id: user.id,
        voter_ncid: picked?.ncid ?? null,
        captured_name: name.trim(),
        captured_location: location.trim() || null,
        notes: notes.trim() || null,
        match_confidence: picked?.confidence ?? null,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      setSaving(false);
      setErr(error?.message ?? "Save failed");
      return;
    }
    if (notes.trim().length >= 4) {
      try {
        await fetch(`/api/interactions/${inserted.id}/enrich`, { method: "POST" });
      } catch {
        // Enrichment is best-effort; navigate anyway.
      }
    }
    setSaving(false);
    if (picked?.ncid) router.push(`/people/${picked.ncid}`);
    else router.push("/");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-2xl px-5 pb-16 pt-6">
      <header className="mb-5 flex items-center justify-between border-b border-[var(--color-border)] pb-4">
        <Link href="/" className="btn-ghost">Home</Link>
        <h1 className="text-lg font-semibold text-[var(--color-primary)]">Add Person</h1>
        <span className="w-12" />
      </header>

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-subtle)]">Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => { setName(e.target.value); setPicked(null); }}
            placeholder="e.g. John Smith"
            className="input"
          />
        </label>

        {name.trim().length >= 3 && !picked && (
          <div className="card overflow-hidden">
            <div className="border-b border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-ink-subtle)]">
              {searching ? "Searching..." : matches.length ? `Top ${matches.length} matches` : "No matches"}
            </div>
            <ul>
              {matches.map((m) => (
                <li key={m.ncid}>
                  <button
                    type="button"
                    onClick={() => setPicked(m)}
                    className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--color-surface-muted)]"
                  >
                    <span>
                      <span className="font-medium">{fullName(m)}</span>
                      <span className="ml-2 text-xs text-[var(--color-ink-subtle)]">
                        {m.res_street_address}{m.res_city ? ", " + m.res_city : ""}
                        {m.birth_year ? ` · b.${m.birth_year}` : ""}
                        {m.party_cd ? ` · ${m.party_cd}` : ""}
                      </span>
                    </span>
                    <span className="font-mono text-xs text-[var(--color-ink-subtle)]">
                      {Math.round(m.confidence * 100)}%
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {picked && (
          <div className="rounded-md border border-[var(--color-success-soft)] bg-[var(--color-success-soft)] p-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <strong className="text-[var(--color-success)]">{fullName(picked)}</strong>
                <div className="text-xs text-[var(--color-ink-muted)]">
                  {picked.res_street_address}{picked.res_city ? ", " + picked.res_city : ""}
                  {picked.precinct_desc ? ` · ${picked.precinct_desc}` : ""}
                </div>
              </div>
              <button type="button" onClick={() => setPicked(null)} className="btn-ghost text-xs">
                change
              </button>
            </div>
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-subtle)]">
            Where / context (optional)
          </span>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. PTA meeting"
            className="input"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-subtle)]">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="e.g. cares about rezoning, supportive, wife is teacher"
            className="input"
          />
          <span className="mt-1 text-xs text-[var(--color-ink-subtle)]">
            Claude will extract issues, sentiment, tags, and a follow-up suggestion.
          </span>
        </label>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={save}
            disabled={saving || name.trim().length < 2}
            className="btn-primary"
          >
            {saving ? "Saving & analyzing..." : "Save"}
          </button>
          {err && <p className="text-sm text-[var(--color-danger)]">{err}</p>}
        </div>
      </div>
    </main>
  );
}

function fullName(m: Match): string {
  return [m.first_name, m.middle_name, m.last_name].filter(Boolean).join(" ");
}
