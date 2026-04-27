import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import AppShell, { type CandidateProfile } from "@/components/AppShell";
import DeleteListButton from "./DeleteListButton";

export const dynamic = "force-dynamic";

type List = {
  id: string;
  name: string;
  state: string | null;
  city: string | null;
  race_type: string | null;
  source_filename: string | null;
  row_count: number;
  created_at: string;
};

const RACE_LABEL: Record<string, string> = {
  primary_dem: "Dem primary",
  primary_rep: "Rep primary",
  primary_any: "Primary",
  general: "General",
  municipal: "Municipal",
  special: "Special",
  unspecified: "",
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
    .select("id, name, state, city, race_type, source_filename, row_count, created_at")
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
          {lists.map((l) => {
            const raceLabel = l.race_type ? RACE_LABEL[l.race_type] ?? "" : "";
            const place = [l.city, l.state].filter(Boolean).join(", ");
            return (
              <li key={l.id} className="card p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--color-ink)]">{l.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {place && <span className="chip chip-neutral">{place}</span>}
                      {raceLabel && <span className="chip chip-primary">{raceLabel}</span>}
                      <span className="text-xs text-[var(--color-ink-subtle)]">
                        {l.row_count.toLocaleString()} voters
                      </span>
                    </div>
                    {l.source_filename && (
                      <div className="mt-1 text-xs text-[var(--color-ink-subtle)] truncate">
                        {l.source_filename}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-2">
                    <span className="text-xs text-[var(--color-ink-subtle)]">
                      {new Date(l.created_at).toLocaleDateString()}
                    </span>
                    <DeleteListButton listId={l.id} listName={l.name} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
