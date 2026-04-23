import { getSupabaseServer } from "@/lib/supabase/server";
import AppShell, { type CandidateProfile } from "@/components/AppShell";
import FundraisingClient from "./FundraisingClient";

export const dynamic = "force-dynamic";

export type Prospect = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  employer: string | null;
  role: string | null;
  estimated_capacity: number | null;
  asked_amount: number | null;
  committed_amount: number | null;
  donated_amount: number | null;
  status: "prospect" | "asked" | "committed" | "donated" | "declined";
  notes: string | null;
  next_step: string | null;
  next_step_date: string | null;
};

export default async function FundraisingPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("candidates")
    .select("candidate_name, office, jurisdiction, election_date, fundraising_goal")
    .eq("user_id", user!.id)
    .maybeSingle<CandidateProfile & { fundraising_goal: number | null }>();

  const { data: prospects } = await supabase
    .from("fundraising_prospects")
    .select("*")
    .order("status", { ascending: true })
    .order("estimated_capacity", { ascending: false, nullsFirst: false })
    .returns<Prospect[]>();

  const goal = profile?.fundraising_goal ?? null;

  return (
    <AppShell profile={profile ?? null}>
      <h2 className="section-label mb-3">Fundraising</h2>
      <FundraisingClient initial={prospects ?? []} goal={goal} />
    </AppShell>
  );
}
