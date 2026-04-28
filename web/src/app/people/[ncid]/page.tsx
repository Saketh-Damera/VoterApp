import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import PersonAIActions from "./PersonAIActions";
import { sentimentChip } from "@/lib/ui/chips";
import { voteTag, raceLabelFor } from "@/lib/ui/voteTag";

export const dynamic = "force-dynamic";

type Voter = {
  ncid: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  res_street_address: string | null;
  res_city: string | null;
  res_zip: string | null;
  party_cd: string | null;
  gender_code: string | null;
  race_code: string | null;
  birth_year: number | null;
  age: number | null;
  registr_dt: string | null;
  precinct_desc: string | null;
  ward_desc: string | null;
  municipality_desc: string | null;
};

type Turnout = {
  ncid: string;
  elections_voted: number;
  last_voted: string | null;
  generals_voted: number;
  primaries_voted: number;
} | null;

type HouseholdMember = {
  ncid: string;
  first_name: string | null;
  last_name: string | null;
  age: number | null;
  party_cd: string | null;
  elections_voted: number | null;
};

type TalkedToWith = HouseholdMember & {
  relationship: string | null;
  source_interaction_id: string | null;
};

type RecentVote = {
  election_date: string;
  election_desc: string | null;
  voting_method: string | null;
};

type Profile = {
  voter: Voter;
  turnout: Turnout;
  household: HouseholdMember[];
  talked_to_with: TalkedToWith[];
  recent_votes: RecentVote[];
};

// Per-participant row joined to its parent interaction. One row per time
// the candidate logged a conversation that included this voter.
type ParticipantRow = {
  id: string;
  captured_name: string;
  relationship: string | null;
  sentiment: string | null;
  issues: string[] | null;
  tags: string[] | null;
  notes: string | null;
  is_primary: boolean;
  interaction_id: string;
  interactions: {
    captured_location: string | null;
    notes: string | null;
    created_at: string;
  } | null;
};

type CoParticipant = {
  interaction_id: string;
  captured_name: string;
  voter_ncid: string | null;
  relationship: string | null;
};

export default async function PersonPage({
  params,
}: {
  params: Promise<{ ncid: string }>;
}) {
  const { ncid } = await params;
  const supabase = await getSupabaseServer();

  const { data: profile } = await supabase.rpc("get_voter_profile", { p_ncid: ncid });
  if (!profile) return notFound();

  const p = profile as Profile;

  // Conversations this voter was part of, with per-participant fields.
  const { data: rawParticipants } = await supabase
    .from("interaction_participants")
    .select(
      "id, captured_name, relationship, sentiment, issues, tags, notes, is_primary, interaction_id, interactions(captured_location, notes, created_at)",
    )
    .eq("voter_ncid", ncid)
    .returns<ParticipantRow[]>();
  const participantRows = (rawParticipants ?? []).slice().sort((a, b) => {
    const aT = a.interactions?.created_at ?? "";
    const bT = b.interactions?.created_at ?? "";
    return bT.localeCompare(aT);
  });

  // For each conversation, the OTHER participants (so we can render
  // "Together with: ..." per row).
  const interactionIds = participantRows.map((r) => r.interaction_id);
  const { data: rawCoP } = interactionIds.length
    ? await supabase
        .from("interaction_participants")
        .select("interaction_id, captured_name, voter_ncid, relationship")
        .in("interaction_id", interactionIds)
    : { data: [] as CoParticipant[] };
  const coByInteraction = new Map<string, CoParticipant[]>();
  for (const row of (rawCoP ?? []) as CoParticipant[]) {
    if (row.voter_ncid === ncid) continue;
    const list = coByInteraction.get(row.interaction_id) ?? [];
    list.push(row);
    coByInteraction.set(row.interaction_id, list);
  }

  const { data: { user } } = await supabase.auth.getUser();
  const { data: candidateRow } = await supabase
    .from("candidates")
    .select("race_type")
    .eq("user_id", user!.id)
    .maybeSingle<{ race_type: string | null }>();
  const raceLabel = raceLabelFor(candidateRow?.race_type ?? null);

  const { data: relevanceRaw } = await supabase.rpc("voter_relevance", { p_ncid: ncid });
  type Relevance = {
    relevant_votes: number;
    total_votes: number;
    recent_votes: number;
    last_voted: string | null;
  };
  const relevance = (relevanceRaw as Relevance | null) ?? null;

  const fullName = [p.voter.first_name, p.voter.middle_name, p.voter.last_name]
    .filter(Boolean)
    .join(" ");

  const voteBadge = relevance
    ? voteTag(relevance.relevant_votes, relevance.total_votes, raceLabel)
    : null;

  return (
    <main className="mx-auto max-w-2xl px-5 pb-16 pt-6">
      <header className="mb-6 border-b border-[var(--color-border)] pb-5">
        <Link href="/" className="btn-ghost">Home</Link>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <h1 className="page-title">{fullName}</h1>
          {voteBadge && (
            <span className={`chip ${voteBadge.chipClass}`}>{voteBadge.text}</span>
          )}
        </div>
        <p className="mt-2 page-subtitle">
          {p.voter.res_street_address}
          {p.voter.res_city ? ", " + p.voter.res_city : ""}
          {p.voter.res_zip ? " " + p.voter.res_zip : ""}
        </p>
        <div className="mt-4">
          <PersonAIActions ncid={ncid} />
        </div>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 text-sm">
        <Fact label="Party" value={p.voter.party_cd} />
        <Fact label="Age" value={p.voter.age != null ? String(p.voter.age) : null} />
        <Fact label="Precinct" value={p.voter.precinct_desc} />
        <Fact label="Registered" value={p.voter.registr_dt} />
        <Fact
          label={`Votes (${raceLabel})`}
          value={
            relevance
              ? `${relevance.relevant_votes} of ${relevance.total_votes} total`
              : "—"
          }
        />
        <Fact label="Last voted" value={relevance?.last_voted ?? p.turnout?.last_voted ?? null} />
      </section>

      {p.household.length > 0 && (
        <section className="mb-6">
          <h2 className="section-label mb-2">Household ({p.household.length})</h2>
          <p className="mb-2 text-xs text-[var(--color-ink-subtle)]">
            Same address and surname in the voter file.
          </p>
          <ul className="space-y-1">
            {p.household.map((h) => (
              <li key={h.ncid} className="card card-hover px-3 py-2 text-sm">
                <Link href={`/people/${h.ncid}`} className="flex items-baseline justify-between">
                  <span>
                    {[h.first_name, h.last_name].filter(Boolean).join(" ")}
                    {h.age != null && <span className="ml-2 text-xs text-[var(--color-ink-subtle)]">{h.age}</span>}
                    {h.party_cd && <span className="ml-2 text-xs text-[var(--color-ink-subtle)]">{h.party_cd}</span>}
                  </span>
                  <span className="text-xs text-[var(--color-ink-subtle)]">
                    {h.elections_voted ?? 0} votes
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.talked_to_with && p.talked_to_with.length > 0 && (
        <section className="mb-6">
          <h2 className="section-label mb-2">Talked to together with ({p.talked_to_with.length})</h2>
          <p className="mb-2 text-xs text-[var(--color-ink-subtle)]">
            People who appeared in the same conversation as this voter.
          </p>
          <ul className="space-y-1">
            {p.talked_to_with.map((t) => (
              <li key={t.ncid} className="card card-hover px-3 py-2 text-sm">
                <Link href={`/people/${t.ncid}`} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {[t.first_name, t.last_name].filter(Boolean).join(" ")}
                    {t.relationship && (
                      <span className="ml-2 text-xs text-[var(--color-ink-subtle)]">{t.relationship}</span>
                    )}
                    {t.party_cd && <span className="ml-2 text-xs text-[var(--color-ink-subtle)]">{t.party_cd}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--color-ink-subtle)]">
                    {t.elections_voted ?? 0} votes
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-6">
        <h2 className="section-label mb-2">
          Conversations {participantRows.length ? `(${participantRows.length})` : ""}
        </h2>
        {!participantRows.length ? (
          <div className="card p-4 text-sm text-[var(--color-ink-subtle)]">No conversations yet.</div>
        ) : (
          <ul className="space-y-2">
            {participantRows.map((row) => {
              const co = coByInteraction.get(row.interaction_id) ?? [];
              const created = row.interactions?.created_at;
              const fallbackNotes = row.interactions?.notes;
              const showFallbackNotes = !row.notes && fallbackNotes;
              return (
                <li key={row.id} className="card p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-[var(--color-ink-subtle)]">
                    <span>
                      {row.interactions?.captured_location ?? "—"}
                      {row.relationship && !row.is_primary && (
                        <span className="ml-2 chip chip-neutral">{row.relationship}</span>
                      )}
                    </span>
                    <span>{created ? new Date(created).toLocaleString() : ""}</span>
                  </div>
                  {row.notes && <p className="mt-1 text-sm text-[var(--color-ink)]">{row.notes}</p>}
                  {showFallbackNotes && (
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{fallbackNotes}</p>
                  )}
                  {(row.sentiment || row.issues?.length || row.tags?.length) && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {row.sentiment && (
                        <span className={`chip ${sentimentChip(row.sentiment)}`}>
                          {row.sentiment.replace(/_/g, " ")}
                        </span>
                      )}
                      {row.issues?.map((x) => (
                        <span key={`issue-${x}`} className="chip chip-primary">{x}</span>
                      ))}
                      {row.tags?.map((x) => (
                        <span key={`tag-${x}`} className="chip chip-neutral">{x}</span>
                      ))}
                    </div>
                  )}
                  {co.length > 0 && (
                    <div className="mt-3 border-t border-[var(--color-border)] pt-2 text-xs text-[var(--color-ink-subtle)]">
                      <span className="font-medium">Together with: </span>
                      {co.map((c, i) => (
                        <span key={`${c.interaction_id}-${i}`}>
                          {c.voter_ncid ? (
                            <Link href={`/people/${c.voter_ncid}`} className="hover:text-[var(--color-primary)]">
                              {c.captured_name}
                            </Link>
                          ) : (
                            <span>{c.captured_name}</span>
                          )}
                          {c.relationship ? ` (${c.relationship})` : ""}
                          {i < co.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {p.recent_votes.length > 0 && (
        <section>
          <h2 className="section-label mb-2">Vote history (most recent)</h2>
          <ul className="space-y-1 text-sm">
            {p.recent_votes.map((v, idx) => (
              <li key={idx} className="card-quiet flex items-baseline justify-between px-3 py-1.5">
                <span>{v.election_desc ?? v.election_date}</span>
                <span className="text-xs text-[var(--color-ink-subtle)]">{v.voting_method}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="card px-3 py-2">
      <div className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-ink-subtle)]">{label}</div>
      <div className="mt-0.5 text-sm text-[var(--color-ink)]">{value ?? "—"}</div>
    </div>
  );
}


