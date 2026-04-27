import { getSupabaseServer } from "@/lib/supabase/server";
import AppShell, { type CandidateProfile } from "@/components/AppShell";
import PeopleClient from "./PeopleClient";

export const dynamic = "force-dynamic";

export type TalkedTo = {
  voter_ncid: string;
  first_name: string | null;
  last_name: string | null;
  res_street_address: string | null;
  res_city: string | null;
  party_cd: string | null;
  last_interaction_id: string;
  last_sentiment: string | null;
  last_notes: string | null;
  last_issues: string[] | null;
  last_tags: string[] | null;
  last_contact: string;
  interaction_count: number;
  relevant_votes: number | null;
  total_votes: number | null;
};

type ExtendedProfile = CandidateProfile & { race_type: string | null };

export default async function PeoplePage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("candidates")
    .select("candidate_name, office, jurisdiction, election_date, race_type")
    .eq("user_id", user!.id)
    .maybeSingle<ExtendedProfile>();

  const { data: raw } = await supabase.rpc("people_talked_to", { p_limit: 500 });
  const people = (raw as TalkedTo[] | null) ?? [];

  return (
    <AppShell profile={profile ?? null}>
      <header className="mb-6 border-b border-[var(--color-border)] pb-6">
        <div className="flex items-baseline justify-between">
          <h1 className="page-title">Voters contacted</h1>
          <a href="/api/export/interactions" className="btn-ghost text-xs" title="Download XLSX">
            Export to Excel
          </a>
        </div>
        <p className="page-subtitle mt-2">
          {people.length} {people.length === 1 ? "voter" : "voters"} you&apos;ve logged a conversation with.
        </p>
      </header>
      <PeopleClient initial={people} raceType={profile?.race_type ?? null} />
    </AppShell>
  );
}
