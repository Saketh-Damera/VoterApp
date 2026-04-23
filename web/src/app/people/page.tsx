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
  last_sentiment: string | null;
  last_issues: string[] | null;
  last_tags: string[] | null;
  last_contact: string;
  interaction_count: number;
  priority: number | null;
};

export default async function PeoplePage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("candidates")
    .select("candidate_name, office, jurisdiction, election_date")
    .eq("user_id", user!.id)
    .maybeSingle<CandidateProfile>();

  const { data: raw } = await supabase.rpc("people_talked_to", { p_limit: 500 });
  const people = (raw as TalkedTo[] | null) ?? [];

  return (
    <AppShell profile={profile ?? null}>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="section-label">People ({people.length})</h2>
        <a href="/api/export/interactions" className="btn-ghost text-xs" title="Download XLSX">
          ⬇ Export to Excel
        </a>
      </div>
      <PeopleClient initial={people} />
    </AppShell>
  );
}
