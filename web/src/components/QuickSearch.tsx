"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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

export default function QuickSearch() {
  const router = useRouter();
  const supabase = getSupabaseBrowser();
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setMatches([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("match_voters", { q: term, max_results: 6 });
      setMatches((data as Match[]) ?? []);
      setOpen(true);
    }, 200);
    return () => clearTimeout(t);
  }, [q, supabase]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(ncid: string) {
    setQ("");
    setOpen(false);
    setMatches([]);
    router.push(`/people/${ncid}`);
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => matches.length > 0 && setOpen(true)}
        placeholder="Search Durham voters by name..."
        className="input"
      />
      {open && matches.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-auto card">
          {matches.map((m) => (
            <button
              key={m.ncid}
              onClick={() => pick(m.ncid)}
              className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--color-surface-muted)]"
            >
              <span>
                <span className="font-medium">
                  {[m.first_name, m.middle_name, m.last_name].filter(Boolean).join(" ")}
                </span>
                <span className="ml-2 text-xs text-[var(--color-ink-subtle)]">
                  {m.res_street_address}{m.res_city ? ", " + m.res_city : ""}
                  {m.birth_year ? ` · b.${m.birth_year}` : ""}
                </span>
              </span>
              <span className="font-mono text-xs text-[var(--color-ink-subtle)]">
                {Math.round(m.confidence * 100)}%
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
