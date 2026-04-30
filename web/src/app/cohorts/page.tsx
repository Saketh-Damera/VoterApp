import { getSupabaseServer } from "@/lib/supabase/server";
import AppShell, { type CandidateProfile } from "@/components/AppShell";
import CohortClient from "./CohortClient";

export const dynamic = "force-dynamic";

export type ListMeta = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  race_type: string | null;
};

export default async function CohortsPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("candidates")
    .select("candidate_name, office, jurisdiction, election_date")
    .eq("user_id", user!.id)
    .maybeSingle<CandidateProfile>();

  const { data: listsRaw } = await supabase
    .from("voter_lists")
    .select("id, name, city, state, race_type")
    .order("created_at", { ascending: false })
    .returns<ListMeta[]>();

  return (
    <AppShell profile={profile ?? null}>
      <header className="mb-6 border-b border-[var(--color-border)] pb-6">
        <h1 className="page-title">Build a cohort</h1>
        <p className="page-subtitle mt-2">
          Describe the voters you want, in plain English. JED translates the
          description into a filter, runs it against your lists, and you can
          download the results as XLSX.
        </p>
      </header>
      <CohortClient lists={listsRaw ?? []} />
    </AppShell>
  );
}
