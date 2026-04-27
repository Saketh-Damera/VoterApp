import { getSupabaseServer } from "@/lib/supabase/server";
import AppShell, { type CandidateProfile } from "@/components/AppShell";
import HistoryClient from "./HistoryClient";

export const dynamic = "force-dynamic";

export type AuditRow = {
  id: string;
  action: "create" | "update" | "delete";
  entity_type: string;
  entity_id: string | null;
  summary: string;
  snapshot: Record<string, unknown> | null;
  created_at: string;
};

export default async function HistoryPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("candidates")
    .select("candidate_name, office, jurisdiction, election_date")
    .eq("user_id", user!.id)
    .maybeSingle<CandidateProfile>();

  const { data: rows } = await supabase
    .from("audit_log")
    .select("id, action, entity_type, entity_id, summary, snapshot, created_at")
    .order("created_at", { ascending: false })
    .limit(500)
    .returns<AuditRow[]>();

  return (
    <AppShell profile={profile ?? null}>
      <header className="mb-6 border-b border-[var(--color-border)] pb-6">
        <h1 className="page-title">History</h1>
        <p className="page-subtitle mt-2">
          Every action you have taken, in chronological order. Deletions keep a JSON snapshot of
          the lost data — click <strong>View snapshot</strong> on any row to recover it manually.
        </p>
      </header>
      <HistoryClient initial={rows ?? []} />
    </AppShell>
  );
}
