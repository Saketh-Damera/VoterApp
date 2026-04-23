import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import AppShell, { type CandidateProfile } from "@/components/AppShell";
import DoneButton from "@/components/DoneButton";
import DailyBriefCard from "@/components/DailyBriefCard";
import DemoBanner from "@/components/DemoBanner";
import AskJedCard from "@/components/AskJedCard";
import { sentimentChip } from "@/lib/ui/chips";
import { voteTag, raceLabelFor } from "@/lib/ui/voteTag";

export const dynamic = "force-dynamic";

type InteractionRow = {
  id: string;
  captured_name: string;
  notes: string | null;
  created_at: string;
  voter_ncid: string | null;
  sentiment: string | null;
  issues: string[] | null;
  tags: string[] | null;
  voters: { first_name: string | null; last_name: string | null; res_city: string | null } | null;
};

type PriorityAction = {
  id: string;
  voter_ncid: string | null;
  first_name: string | null;
  last_name: string | null;
  res_city: string | null;
  message: string | null;
  due_at: string;
  sentiment: string | null;
  relevant_votes: number | null;
  total_votes: number | null;
};

type Stats = {
  people_tracked: number;
  interactions_total: number;
  interactions_7d: number;
  supportive_count: number;
  undecided_count: number;
  pending_reminders: number;
  pending_todos: number;
  fundraising_committed: number;
  fundraising_donated: number;
  fundraising_goal: number | null;
};

type Todo = {
  id: string;
  title: string;
  due_date: string | null;
};

type ExtendedProfile = CandidateProfile & { race_type: string | null };

export default async function HomePage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("candidates")
    .select("candidate_name, office, jurisdiction, election_date, race_type")
    .eq("user_id", user!.id)
    .maybeSingle<ExtendedProfile>();
  if (!profile) redirect("/settings");

  const [
    { data: statsData },
    { data: interactions },
    { data: actionsRaw },
    { data: todos },
  ] = await Promise.all([
    supabase.rpc("dashboard_stats"),
    supabase
      .from("interactions")
      .select("id, captured_name, notes, created_at, voter_ncid, sentiment, issues, tags, voters(first_name, last_name, res_city)")
      .order("created_at", { ascending: false })
      .limit(10)
      .returns<InteractionRow[]>(),
    supabase.rpc("top_priority_actions", { p_limit: 5 }),
    supabase
      .from("todos")
      .select("id, title, due_date")
      .eq("status", "pending")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(5)
      .returns<Todo[]>(),
  ]);

  const stats = (statsData as Stats | null) ?? null;
  const actions = (actionsRaw as PriorityAction[] | null) ?? [];
  const raceLabel = raceLabelFor(profile.race_type);

  const isDemo = user?.is_anonymous === true;

  return (
    <AppShell profile={profile ?? null}>
      {isDemo && <DemoBanner />}

      {/* Ask JED at top */}
      <AskJedCard />

      {/* Stats row */}
      {stats && (
        <section className="mb-10">
          <div className="section-heading">
            <h2>At a glance</h2>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="People tracked" value={stats.people_tracked.toLocaleString()} />
            <Stat label="This week" value={String(stats.interactions_7d)} sub="interactions" />
            <Stat label="Supportive" value={String(stats.supportive_count)} />
            <Stat label="Undecided" value={String(stats.undecided_count)} />
            <Stat
              label="Fundraising"
              value={"$" + Math.round(stats.fundraising_committed).toLocaleString()}
              sub={stats.fundraising_goal ? `of $${Math.round(stats.fundraising_goal).toLocaleString()}` : "committed"}
            />
            <Stat label="Open todos" value={String(stats.pending_todos)} />
          </div>
        </section>
      )}

      <section className="mb-10">
        <div className="section-heading">
          <h2>Daily brief</h2>
        </div>
        <DailyBriefCard />
      </section>

      <div className="divider-strong" />

      {/* 3-col dashboard */}
      <div className="grid gap-10 lg:grid-cols-3">
        <section>
          <div className="section-heading">
            <h2>Follow-ups due</h2>
          </div>
          {!actions.length ? (
            <p className="text-sm text-[var(--color-ink-subtle)]">
              Nothing scheduled. Log a conversation to seed follow-ups.
            </p>
          ) : (
            <ul className="space-y-3">
              {actions.map((a) => {
                const name = [a.first_name, a.last_name].filter(Boolean).join(" ") || "(unmatched)";
                const href = a.voter_ncid ? `/people/${a.voter_ncid}` : "#";
                const tag = voteTag(a.relevant_votes, a.total_votes, raceLabel);
                return (
                  <li key={a.id} className="border-b border-[var(--color-border)] pb-3 last:border-0">
                    <div className="flex items-start justify-between gap-3">
                      <Link href={href} className="flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="font-medium">{name}</span>
                          <span className={`chip ${tag.chipClass}`}>{tag.text}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--color-ink-subtle)]">
                          due {new Date(a.due_at).toLocaleDateString()}
                          {a.res_city && <span> · {a.res_city}</span>}
                          {a.sentiment && <span> · {a.sentiment.replace(/_/g, " ")}</span>}
                        </div>
                        {a.message && (
                          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{a.message}</p>
                        )}
                      </Link>
                      <DoneButton reminderId={a.id} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <div className="section-heading">
            <h2>Your agenda</h2>
            <Link href="/todos" className="btn-ghost text-xs">manage</Link>
          </div>
          {!todos?.length ? (
            <p className="text-sm text-[var(--color-ink-subtle)]">
              Nothing on the list. <Link href="/todos" className="underline hover:text-[var(--color-ink)]">Add one.</Link>
            </p>
          ) : (
            <ul className="space-y-3">
              {todos.map((t) => (
                <li key={t.id} className="border-b border-[var(--color-border)] pb-3 last:border-0 text-sm">
                  <Link href="/todos" className="flex items-baseline justify-between gap-3">
                    <span>{t.title}</span>
                    {t.due_date && (
                      <span className="text-xs text-[var(--color-ink-subtle)]">
                        {new Date(t.due_date).toLocaleDateString()}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-10">
            <div className="section-heading">
              <h2>Fundraising</h2>
              <Link href="/fundraising" className="btn-ghost text-xs">pipeline</Link>
            </div>
            {stats && (
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-[var(--color-ink-muted)]">Committed</span>
                  <span className="display-num">
                    ${Math.round(stats.fundraising_committed).toLocaleString()}
                  </span>
                </div>
                {stats.fundraising_goal && (
                  <>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-muted)]">
                      <div
                        className="h-full bg-[var(--color-ink)]"
                        style={{
                          width: `${Math.min(100, Math.round((stats.fundraising_committed / stats.fundraising_goal) * 100))}%`,
                        }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">
                      of ${Math.round(stats.fundraising_goal).toLocaleString()} goal
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="section-heading">
            <h2>Recent conversations</h2>
            <a href="/api/export/interactions" className="btn-ghost text-xs" title="Download XLSX">
              Export
            </a>
          </div>
          {!interactions?.length ? (
            <p className="text-sm text-[var(--color-ink-subtle)]">
              No conversations yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {interactions.map((i) => {
                const name = i.voters
                  ? `${i.voters.first_name ?? ""} ${i.voters.last_name ?? ""}`.trim()
                  : i.captured_name;
                const href = i.voter_ncid ? `/people/${i.voter_ncid}` : "#";
                return (
                  <li key={i.id} className="border-b border-[var(--color-border)] pb-3 last:border-0">
                    <Link href={href} className="block">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-sm">{name}</span>
                        <span className="text-xs text-[var(--color-ink-subtle)]">
                          {new Date(i.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      {i.notes && (
                        <p className="mt-1 line-clamp-2 text-sm text-[var(--color-ink-muted)]">
                          {i.notes}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {i.sentiment && (
                          <span className={`chip ${sentimentChip(i.sentiment)}`}>
                            {i.sentiment.replace(/_/g, " ")}
                          </span>
                        )}
                        {i.issues?.slice(0, 2).map((x) => (
                          <span key={`iss-${x}`} className="chip chip-primary">{x}</span>
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
      </div>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="section-label">{label}</div>
      <div className="display-num mt-1 text-[var(--color-ink)]">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[var(--color-ink-subtle)]">{sub}</div>}
    </div>
  );
}
