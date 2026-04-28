import { getSupabaseServer } from "@/lib/supabase/server";
import AppShell, { type CandidateProfile } from "@/components/AppShell";
import PeopleClient from "./PeopleClient";
import ExportButton from "./ExportButton";

export const dynamic = "force-dynamic";

export type TalkedTo = {
  voter_ncid: string | null;
  first_name: string | null;
  last_name: string | null;
  res_street_address: string | null;
  res_city: string | null;
  party_cd: string | null;
  last_participant_id: string;
  last_sentiment: string | null;
  last_notes: string | null;
  last_issues: string[] | null;
  last_tags: string[] | null;
  last_relationship: string | null;
  last_contact: string;
  interaction_count: number;
  relevant_votes: number | null;
  total_votes: number | null;
  is_unmatched: boolean;
  captured_name: string | null;
  list_ids: string[] | null;
};

export type ListMeta = {
  id: string;
  name: string;
  city: string | null;
  race_type: string | null;
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

  const { data: listsRaw } = await supabase
    .from("voter_lists")
    .select("id, name, city, race_type")
    .order("created_at", { ascending: false })
    .returns<ListMeta[]>();
  const lists = listsRaw ?? [];

  return (
    <AppShell profile={profile ?? null}>
      <header className="mb-6 border-b border-[var(--color-border)] pb-6">
        <div className="flex items-baseline justify-between">
          <h1 className="page-title">Voters contacted</h1>
          <ExportButton />
        </div>
        <p className="page-subtitle mt-2">
          {people.length} {people.length === 1 ? "voter" : "voters"} you&apos;ve logged a conversation with.
        </p>
      </header>
      <PeopleClient initial={people} raceType={profile?.race_type ?? null} lists={lists} />
    </AppShell>
  );
}
