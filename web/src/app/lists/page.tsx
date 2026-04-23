import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import AppShell, { type CandidateProfile } from "@/components/AppShell";

export const dynamic = "force-dynamic";

type List = {
  id: string;
  name: string;
  state: string | null;
  source_filename: string | null;
  row_count: number;
  created_at: string;
};

export default async function ListsPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("candidates")
    .select("candidate_name, office, jurisdiction, election_date")
    .eq("user_id", user!.id)
    .maybeSingle<CandidateProfile>();

  const { data: lists } = await supabase
    .from("voter_lists")
    .select("id, name, state, source_filename, row_count, created_at")
    .order("created_at", { ascending: false })
    .returns<List[]>();

  return (
    <AppShell profile={profile ?? null}>
      <section className="mb-5">
        <div className="flex items-baseline justify-between">
          <h2 className="section-label">Voter lists</h2>
          <Link href="/lists/new" className="btn-primary">+ Upload list</Link>
        </div>
        <p className="mt-1 text-sm text-[var(--color-ink-subtle)]">
          Each list is private to your campaign. Upload state voter files, campaign-provided exports,
          or any CSV/XLSX with names and addresses. JED maps the columns for you.
        </p>
      </section>

      {!lists?.length ? (
        <div className="card p-5 text-sm text-[var(--color-ink-subtle)]">
          No lists yet. Click <strong>Upload list</strong> above to add your first.
        </div>
      ) : (
        <ul className="space-y-2">
          {lists.map((l) => (
            <li key={l.id} className="card p-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="font-medium text-[var(--color-ink)]">{l.name}</div>
                  <div className="text-xs text-[var(--color-ink-subtle)]">
                    {l.state ? `${l.state} · ` : ""}
                    {l.row_count.toLocaleString()} voters
                    {l.source_filename ? ` · ${l.source_filename}` : ""}
                  </div>
                </div>
                <span className="text-xs text-[var(--color-ink-subtle)]">
                  {new Date(l.created_at).toLocaleDateString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
