import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import AppHeader, { type CandidateProfile } from "@/components/AppHeader";
import DoneButton from "@/components/DoneButton";

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

export default async function HomePage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("candidates")
    .select("candidate_name, office, jurisdiction, election_date")
    .eq("user_id", user!.id)
    .maybeSingle<CandidateProfile>();

  const { data: interactions } = await supabase
    .from("interactions")
    .select("id, captured_name, notes, created_at, voter_ncid, sentiment, issues, tags, voters(first_name, last_name, res_city)")
    .order("created_at", { ascending: false })
    .limit(25)
    .returns<InteractionRow[]>();

  const { data: actionsRaw } = await supabase.rpc("top_priority_actions", { p_limit: 3 });
  const actions = (actionsRaw as PriorityAction[] | null) ?? [];

  const { count: totalPeople } = await supabase
    .from("interactions")
    .select("voter_ncid", { count: "exact", head: true })
    .not("voter_ncid", "is", null);

  return (
    <main className="mx-auto max-w-2xl px-5 pb-16 pt-6">
      <AppHeader profile={profile ?? null} />

      <section className="mb-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="section-label">Top 3 priority actions</h2>
          {totalPeople !== null && (
            <span className="text-xs text-[var(--color-ink-subtle)]">
              {totalPeople} {totalPeople === 1 ? "person" : "people"} tracked
            </span>
          )}
        </div>
        {!actions.length ? (
          <div className="card p-5 text-sm text-[var(--color-ink-subtle)]">
            No follow-ups scheduled yet. Add a person with notes to seed your first action.
          </div>
        ) : (
          <ul className="space-y-2">
            {actions.map((a) => {
              const name = [a.first_name, a.last_name].filter(Boolean).join(" ") || "(unmatched)";
              const href = a.voter_ncid ? `/people/${a.voter_ncid}` : "#";
              return (
                <li key={a.id} className="card card-hover p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={href} className="flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium text-[var(--color-ink)]">{name}</span>
                        <span className={`chip ${priorityChip(a.priority)}`}>
                          priority {Math.round(a.priority)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-[var(--color-ink-subtle)]">
                        {a.res_city ?? ""}
                        {a.sentiment && <span> · {a.sentiment.replace(/_/g, " ")}</span>}
                        <span> · due {new Date(a.due_at).toLocaleDateString()}</span>
                      </div>
                      {a.message && (
                        <p className="mt-2 text-sm text-[var(--color-ink)]">{a.message}</p>
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-label">Recent interactions</h2>
          <a href="/api/export/interactions" className="btn-ghost text-xs" title="Download XLSX">
            ⬇ Export
          </a>
        </div>
        {!interactions?.length ? (
          <div className="card p-5 text-sm text-[var(--color-ink-subtle)]">
            No interactions yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {interactions.map((i) => {
              const name = i.voters
                ? `${i.voters.first_name ?? ""} ${i.voters.last_name ?? ""}`.trim()
                : i.captured_name;
              const href = i.voter_ncid ? `/people/${i.voter_ncid}` : "#";
              return (
                <li key={i.id} className="card card-hover p-4">
                  <Link href={href} className="block">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{name}</span>
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
    </main>
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
