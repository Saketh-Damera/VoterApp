import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import AppShell, { type CandidateProfile } from "@/components/AppShell";
import DoneButton from "@/components/DoneButton";
import DailyBriefCard from "@/components/DailyBriefCard";

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
  priority: number;
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

export default async function HomePage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const [
    { data: profile },
    { data: statsData },
    { data: interactions },
    { data: actionsRaw },
    { data: todos },
  ] = await Promise.all([
    supabase.from("candidates").select("candidate_name, office, jurisdiction, election_date").eq("user_id", user!.id).maybeSingle<CandidateProfile>(),
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

  return (
    <AppShell profile={profile ?? null}>
      {/* Stats row */}
      {stats && (
        <section className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          <Stat label="People tracked" value={stats.people_tracked.toLocaleString()} />
          <Stat label="This week" value={String(stats.interactions_7d)} sub="interactions" />
          <Stat label="Supportive" value={String(stats.supportive_count)} tone="success" />
          <Stat label="Undecided" value={String(stats.undecided_count)} tone="warning" />
          <Stat
            label="Fundraising"
            value={"$" + Math.round(stats.fundraising_committed).toLocaleString()}
            sub={stats.fundraising_goal ? `of $${Math.round(stats.fundraising_goal).toLocaleString()}` : "committed"}
          />
          <Stat label="Open todos" value={String(stats.pending_todos)} />
        </section>
      )}

      {/* Daily brief banner */}
      <section className="mb-6">
        <DailyBriefCard />
      </section>

      {/* 3-col dashboard on large screens */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Col 1: Top priorities */}
        <section className="lg:col-span-1">
          <h2 className="section-label mb-3">Top priorities</h2>
          {!actions.length ? (
            <div className="card p-4 text-sm text-[var(--color-ink-subtle)]">
              No follow-ups scheduled yet.
            </div>
          ) : (
            <ul className="space-y-2">
              {actions.map((a) => {
                const name = [a.first_name, a.last_name].filter(Boolean).join(" ") || "(unmatched)";
                const href = a.voter_ncid ? `/people/${a.voter_ncid}` : "#";
                return (
                  <li key={a.id} className="card card-hover p-3">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={href} className="flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="font-medium text-sm">{name}</span>
                          <span className={`chip ${priorityChip(a.priority)}`}>
                            {Math.round(a.priority)}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--color-ink-subtle)]">
                          {a.res_city ?? ""}
                          {a.sentiment && <span> · {a.sentiment.replace(/_/g, " ")}</span>}
                        </div>
                        {a.message && (
                          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{a.message}</p>
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

        {/* Col 2: Todos + reminders */}
        <section className="lg:col-span-1">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="section-label">Your agenda</h2>
            <Link href="/todos" className="btn-ghost text-xs">manage</Link>
          </div>
          {!todos?.length ? (
            <div className="card p-4 text-sm text-[var(--color-ink-subtle)]">
              No to-dos open.
              <Link href="/todos" className="ml-2 text-[var(--color-primary)] hover:underline">
                add one
              </Link>
            </div>
          ) : (
            <ul className="space-y-2">
              {todos.map((t) => (
                <li key={t.id} className="card card-hover p-3 text-sm">
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

          <div className="mt-6">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="section-label">Fundraising</h2>
              <Link href="/fundraising" className="btn-ghost text-xs">pipeline</Link>
            </div>
            {stats && (
              <div className="card p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-[var(--color-ink-muted)]">Committed</span>
                  <span className="text-lg font-semibold text-[var(--color-ink)]">
                    ${Math.round(stats.fundraising_committed).toLocaleString()}
                  </span>
                </div>
                {stats.fundraising_goal && (
                  <>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-muted)]">
                      <div
                        className="h-full bg-[var(--color-primary)]"
                        style={{
                          width: `${Math.min(100, Math.round((stats.fundraising_committed / stats.fundraising_goal) * 100))}%`,
                        }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">
                      Goal ${Math.round(stats.fundraising_goal).toLocaleString()}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Col 3: Recent interactions */}
        <section className="lg:col-span-1">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-label">Recent interactions</h2>
            <a href="/api/export/interactions" className="btn-ghost text-xs" title="Download XLSX">
              ⬇ Export
            </a>
          </div>
          {!interactions?.length ? (
            <div className="card p-4 text-sm text-[var(--color-ink-subtle)]">
              No interactions yet. Add one.
            </div>
          ) : (
            <ul className="space-y-2">
              {interactions.map((i) => {
                const name = i.voters
                  ? `${i.voters.first_name ?? ""} ${i.voters.last_name ?? ""}`.trim()
                  : i.captured_name;
                const href = i.voter_ncid ? `/people/${i.voter_ncid}` : "#";
                return (
                  <li key={i.id} className="card card-hover p-3">
                    <Link href={href} className="block">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-sm">{name}</span>
                        <span className="text-xs text-[var(--color-ink-subtle)]">
                          {new Date(i.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      {i.notes && (
                        <p className="mt-1 line-clamp-2 text-xs text-[var(--color-ink-muted)]">
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
                        {i.tags?.slice(0, 2).map((x) => (
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
      </div>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "success" | "warning";
}) {
  const toneClass =
    tone === "success"
      ? "text-[var(--color-success)]"
      : tone === "warning"
      ? "text-[var(--color-warning)]"
      : "text-[var(--color-ink)]";
  return (
    <div className="card px-3 py-2">
      <div className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-ink-subtle)]">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="text-[0.6875rem] text-[var(--color-ink-subtle)]">{sub}</div>}
    </div>
  );
}

function priorityChip(p: number): string {
  if (p >= 50) return "chip-danger";
  if (p >= 25) return "chip-warning";
  if (p >= 10) return "chip-primary";
  return "chip-neutral";
}

function sentimentChip(s: string): string {
  switch (s) {
    case "supportive":
    case "leaning_supportive":
      return "chip-success";
    case "opposed":
    case "leaning_opposed":
      return "chip-danger";
    case "undecided":
      return "chip-warning";
    default:
      return "chip-neutral";
  }
}
