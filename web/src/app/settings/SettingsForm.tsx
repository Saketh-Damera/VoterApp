"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

type Candidate = {
  user_id: string;
  candidate_name: string;
  office: string | null;
  jurisdiction: string | null;
  election_date: string | null;
  fundraising_goal: number | null;
  scratchpad: string | null;
  race_type: string | null;
};

const RACE_TYPES: Array<{ value: string; label: string; desc: string }> = [
  { value: "primary_dem", label: "Democratic primary", desc: "Voters who vote in Dem primaries" },
  { value: "primary_rep", label: "Republican primary", desc: "Voters who vote in Rep primaries" },
  { value: "primary_any", label: "Non-partisan primary", desc: "Voters who vote in any primary" },
  { value: "general",     label: "General election",    desc: "Voters who show up in generals" },
  { value: "municipal",   label: "Municipal / local",   desc: "Voters who show up for local races (usually low turnout)" },
  { value: "special",     label: "Special election",    desc: "Voters reliable in off-cycle specials" },
  { value: "unspecified", label: "Not sure yet",        desc: "Show total vote counts instead" },
];

export default function SettingsForm({
  initial,
  userEmail,
}: {
  initial: Candidate | null;
  userEmail: string;
}) {
  const router = useRouter();
  const supabase = getSupabaseBrowser();
  const [name, setName] = useState(initial?.candidate_name ?? "");
  const [office, setOffice] = useState(initial?.office ?? "");
  const [jurisdiction, setJurisdiction] = useState(initial?.jurisdiction ?? "");
  const [electionDate, setElectionDate] = useState(initial?.election_date ?? "");
  const [goal, setGoal] = useState(initial?.fundraising_goal?.toString() ?? "");
  const [scratchpad, setScratchpad] = useState(initial?.scratchpad ?? "");
  const [raceType, setRaceType] = useState(initial?.race_type ?? "unspecified");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setErr("Not signed in");
      setSaving(false);
      return;
    }
    const goalNum = goal.trim() ? parseFloat(goal) : null;
    const { error } = await supabase.from("candidates").upsert({
      user_id: user.id,
      candidate_name: name.trim(),
      office: office.trim() || null,
      jurisdiction: jurisdiction.trim() || null,
      election_date: electionDate || null,
      fundraising_goal: goalNum,
      scratchpad: scratchpad,
      race_type: raceType,
    });
    setSaving(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setSaved(true);
    router.refresh();
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">
        Signed in as <span className="font-mono">{userEmail}</span>
      </p>

      <Field label="Candidate name" hint="How you'll be addressed to voters.">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Saketh Damera"
          className="input"
        />
      </Field>

      <Field label="Office">
        <input
          value={office}
          onChange={(e) => setOffice(e.target.value)}
          placeholder="e.g. Durham City Council"
          className="input"
        />
      </Field>

      <Field label="Jurisdiction">
        <input
          value={jurisdiction}
          onChange={(e) => setJurisdiction(e.target.value)}
          placeholder="e.g. Ward 2, Durham NC"
          className="input"
        />
      </Field>

      <Field label="Election date" hint="Drives the GOTV-window boost.">
        <input
          type="date"
          value={electionDate}
          onChange={(e) => setElectionDate(e.target.value)}
          className="input"
        />
      </Field>

      <Field label="Race type" hint="JED tags voters by how often they've voted in races of this type.">
        <select
          value={raceType}
          onChange={(e) => setRaceType(e.target.value)}
          className="input"
        >
          {RACE_TYPES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-[var(--color-ink-subtle)]">
          {RACE_TYPES.find((r) => r.value === raceType)?.desc}
        </span>
      </Field>

      <Field label="Fundraising goal ($)" hint="Shows as a progress bar on the dashboard and /fundraising.">
        <input
          type="number"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. 25000"
          className="input"
        />
      </Field>

      <Field label="Scratchpad" hint="Personal notes — only you see this.">
        <textarea
          value={scratchpad}
          onChange={(e) => setScratchpad(e.target.value)}
          rows={5}
          placeholder="Anything you want to keep in one place."
          className="input"
        />
      </Field>

      <div className="flex items-center gap-3 pt-2">
        <button type="submit" disabled={saving || !name.trim()} className="btn-primary">
          {saving ? "Saving..." : "Save"}
        </button>
        {saved && <span className="text-sm text-[var(--color-success)]">Saved.</span>}
        {err && <span className="text-sm text-[var(--color-danger)]">{err}</span>}
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-[var(--color-ink)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-[var(--color-ink-subtle)]">{hint}</span>}
    </label>
  );
}
