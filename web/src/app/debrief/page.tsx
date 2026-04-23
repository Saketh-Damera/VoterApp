import { getSupabaseServer } from "@/lib/supabase/server";
import AppShell, { type CandidateProfile } from "@/components/AppShell";
import DebriefClient from "./DebriefClient";

export const dynamic = "force-dynamic";

export default async function DebriefPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("candidates")
    .select("candidate_name, office, jurisdiction, election_date")
    .eq("user_id", user!.id)
    .maybeSingle<CandidateProfile>();

  return (
    <AppShell profile={profile ?? null}>
      <div className="mx-auto max-w-xl">
        <h2 className="section-label mb-3">Talk to JED</h2>
        <p className="mb-5 text-sm text-[var(--color-ink-subtle)]">
          Tell JED what happened — either speak into your mic or type it out. Claude fills in the rest:
          finds the voter in your list, extracts support level, issues, tags, and schedules a follow-up
          if one is warranted.
        </p>
        <DebriefClient />
      </div>
    </AppShell>
  );
}
