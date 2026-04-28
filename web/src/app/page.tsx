import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import AppShell, { type CandidateProfile } from "@/components/AppShell";
import DemoBanner from "@/components/DemoBanner";
import AskJedCard from "@/components/AskJedCard";
import { sentimentChip } from "@/lib/ui/chips";

export const dynamic = "force-dynamic";

// Recent activity feed: one row per primary participant of each conversation.
// Reads from interaction_participants joined to interactions for the encounter
// timestamp + notes, and to voters for the matched person's name.
type RecentRow = {
  id: string;
  captured_name: string;
  voter_ncid: string | null;
  sentiment: string | null;
  issues: string[] | null;
  tags: string[] | null;
  interactions: {
    id: string;
    notes: string | null;
    created_at: string;
  } | null;
  voters: { first_name: string | null; last_name: string | null; res_city: string | null } | null;
};

type Stats = {
  people_tracked: number;
  interactions_total: number;
  interactions_7d: number;
  supportive_count: number;
  undecided_count: number;
};

export default async function HomePage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("candidates")
    .select("candidate_name, office, jurisdiction, election_date")
    .eq("user_id", user!.id)
    .maybeSingle<CandidateProfile>();
  if (!profile) redirect("/settings");

  const [{ data: statsData }, { data: rawRecent }] = await Promise.all([
    supabase.rpc("dashboard_stats"),
    supabase
      .from("interaction_participants")
      .select(
        "id, captured_name, voter_ncid, sentiment, issues, tags, " +
          "interactions(id, notes, created_at), " +
          "voters(first_name, last_name, res_city)",
      )
      .eq("is_primary", true)
      .limit(50)
      .returns<RecentRow[]>(),
  ]);

  const stats = (statsData as Stats | null) ?? null;
  const interactions = (rawRecent ?? [])
    .slice()
    .sort((a, b) => {
      const aT = a.interactions?.created_at ?? "";
      const bT = b.interactions?.created_at ?? "";
      return bT.localeCompare(aT);
    })
    .slice(0, 15);
  const isDemo = user?.is_anonymous === true;

  return (
    <AppShell profile={profile ?? null}>
      {isDemo && <DemoBanner />}

      <AskJedCard />

      {stats && (
        <section className="mb-10">
          <div className="section-heading">
            <h2>At a glance</h2>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <Stat label="People tracked" value={stats.people_tracked.toLocaleString()} />
            <Stat label="This week" value={String(stats.interactions_7d)} sub="conversations" />
            <Stat label="Supportive" value={String(stats.supportive_count)} />
            <Stat label="Undecided" value={String(stats.undecided_count)} />
          </div>
        </section>
      )}

      <section>
        <div className="section-heading">
          <h2>Recent conversations</h2>
          <a href="/api/export/interactions" className="btn-ghost text-xs" title="Download XLSX">
            Export
          </a>
        </div>
        {!interactions?.length ? (
          <p className="text-sm text-[var(--color-ink-subtle)]">
            No conversations yet. Use{" "}
            <Link href="/debrief" className="underline hover:text-[var(--color-ink)]">Talk to JED</Link>{" "}
            to log your first.
          </p>
        ) : (
          <ul className="space-y-3">
            {interactions.map((i) => {
              const name = i.voters
                ? `${i.voters.first_name ?? ""} ${i.voters.last_name ?? ""}`.trim()
                : i.captured_name;
              const href = i.voter_ncid ? `/people/${i.voter_ncid}` : "#";
              const created = i.interactions?.created_at;
              const notes = i.interactions?.notes;
              return (
                <li key={i.id} className="border-b border-[var(--color-border)] pb-3 last:border-0">
                  <Link href={href} className="block">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{name}</span>
                      <span className="text-xs text-[var(--color-ink-subtle)]">
                        {created ? new Date(created).toLocaleDateString() : ""}
                      </span>
                    </div>
                    {notes && (
                      <p className="mt-1 line-clamp-2 text-sm text-[var(--color-ink-muted)]">
                        {notes}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {i.sentiment && (
                        <span className={`chip ${sentimentChip(i.sentiment)}`}>
                          {i.sentiment.replace(/_/g, " ")}
                        </span>
                      )}
                      {i.issues?.slice(0, 3).map((x) => (
                        <span key={`iss-${x}`} className="chip chip-primary">{x}</span>
                      ))}
                      {i.tags?.slice(0, 3).map((x) => (
                        <span key={`tag-${x}`} className="chip chip-neutral">{x}</span>
                      ))}
                      {!i.voter_ncid && <span className="chip chip-warning">unmatched</span>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </AppShell>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="section-label">{label}</div>
      <div className="display-num mt-1">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[var(--color-ink-subtle)]">{sub}</div>}
    </div>
  );
}
