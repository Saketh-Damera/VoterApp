import { getSupabaseServer } from "@/lib/supabase/server";
import AppShell, { type CandidateProfile } from "@/components/AppShell";
import DonorImportClient from "./DonorImportClient";

export const dynamic = "force-dynamic";

export default async function ImportDonorsPage() {
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
        <h2 className="section-label mb-3">Import donors</h2>
        <p className="mb-5 text-sm text-[var(--color-ink-subtle)]">
          Upload a CSV, TSV, or Excel file of donor prospects. Columns can be in any order — JED
          auto-maps them (name, email, phone, employer, role, capacity, notes).
        </p>
        <DonorImportClient />
      </div>
    </AppShell>
  );
}
