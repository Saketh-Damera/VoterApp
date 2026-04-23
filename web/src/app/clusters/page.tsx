import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import AppShell, { type CandidateProfile } from "@/components/AppShell";

export const dynamic = "force-dynamic";

type Cluster = {
  street_label: string | null;
  city: string | null;
  people_count: number;
  latest_contact: string | null;
  avg_priority: number | null;
  top_sentiments: string[] | null;
  voter_ncids: string[];
};

export default async function ClustersPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("candidates")
    .select("candidate_name, office, jurisdiction, election_date")
    .eq("user_id", user!.id)
    .maybeSingle<CandidateProfile>();

  const { data: raw } = await supabase.rpc("contacted_clusters", { p_limit: 50 });
  const clusters = (raw as Cluster[] | null) ?? [];

  return (
    <AppShell profile={profile ?? null}>

      <section className="mb-6">
        <h2 className="section-label mb-1">Neighbor clusters</h2>
        <p className="text-sm text-[var(--color-ink-subtle)]">
          Groups of contacted voters on the same street. Good for door-knocking routes.
        </p>
      </section>

      {!clusters.length ? (
        <div className="card p-5 text-sm text-[var(--color-ink-subtle)]">
          No clusters yet — add interactions with matched voters to populate.
        </div>
      ) : (
        <ul className="space-y-3">
          {clusters.map((c, i) => (
            <li key={`${c.street_label}-${c.city}-${i}`} className="card p-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <span className="font-medium text-[var(--color-ink)]">
                    {c.street_label ?? "(unknown street)"}
                  </span>
                  <span className="ml-2 text-sm text-[var(--color-ink-subtle)]">{c.city}</span>
                </div>
                <span className="chip chip-primary">
                  {c.people_count} {c.people_count === 1 ? "person" : "people"}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-subtle)]">
                {c.avg_priority !== null && <span>avg priority {Math.round(c.avg_priority)}</span>}
                {c.latest_contact && (
                  <span>· last {new Date(c.latest_contact).toLocaleDateString()}</span>
                )}
                {c.top_sentiments?.map((s) => (
                  <span key={s} className="chip chip-neutral">
                    {s.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
              <ul className="mt-3 flex flex-wrap gap-1">
                {c.voter_ncids.slice(0, 8).map((ncid) => (
                  <li key={ncid}>
                    <Link
                      href={`/people/${ncid}`}
                      className="inline-block rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-0.5 font-mono text-xs text-[var(--color-ink-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-primary)]"
                    >
                      {ncid}
                    </Link>
                  </li>
                ))}
                {c.voter_ncids.length > 8 && (
                  <li className="text-xs text-[var(--color-ink-subtle)] self-center">
                    +{c.voter_ncids.length - 8} more
                  </li>
                )}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
