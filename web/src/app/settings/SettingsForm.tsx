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
};

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
    const { error } = await supabase.from("candidates").upsert({
      user_id: user.id,
      candidate_name: name.trim(),
      office: office.trim() || null,
      jurisdiction: jurisdiction.trim() || null,
      election_date: electionDate || null,
    });
    setSaving(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setSaved(true);
    router.refresh();
    setTimeout(() => router.push("/"), 500);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">
        Signed in as <span className="font-mono">{userEmail}</span>
      </p>

      <Field label="Candidate name" hint="How you'll be addressed on the ballot and to voters.">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Saketh Damera"
          className="input"
        />
      </Field>

      <Field label="Office" hint="The seat you're running for.">
        <input
          value={office}
          onChange={(e) => setOffice(e.target.value)}
          placeholder="e.g. Durham City Council"
          className="input"
        />
      </Field>

      <Field label="Jurisdiction" hint="District, ward, or city.">
        <input
          value={jurisdiction}
          onChange={(e) => setJurisdiction(e.target.value)}
          placeholder="e.g. Ward 2, Durham NC"
          className="input"
        />
      </Field>

      <Field label="Election date" hint="Used to prioritize GOTV-window contacts.">
        <input
          type="date"
          value={electionDate}
          onChange={(e) => setElectionDate(e.target.value)}
          className="input"
        />
      </Field>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="btn-primary"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-sm text-emerald-700">Saved ✓</span>}
        {err && <span className="text-sm text-red-600">{err}</span>}
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
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
