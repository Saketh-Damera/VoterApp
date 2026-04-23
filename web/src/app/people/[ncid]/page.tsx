import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import PersonAIActions from "./PersonAIActions";
import FundraiseButton from "./FundraiseButton";
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

type RecentVote = {
  election_date: string;
  election_desc: string | null;
  voting_method: string | null;
};

type Profile = {
  voter: Voter;
  turnout: Turnout;
  household: HouseholdMember[];
  recent_votes: RecentVote[];
};

type Interaction = {
  id: string;
  captured_name: string;
  captured_location: string | null;
  notes: string | null;
  created_at: string;
  issues: string[] | null;
  sentiment: string | null;
  tags: string[] | null;
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

  const { data: interactions } = await supabase
    .from("interactions")
    .select("id, captured_name, captured_location, notes, created_at, issues, sentiment, tags")
    .eq("voter_ncid", ncid)
    .order("created_at", { ascending: false })
    .returns<Interaction[]>();

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

  const { data: prospectRow } = await supabase
    .from("fundraising_prospects")
    .select("id, status, estimated_capacity, asked_amount, committed_amount, donated_amount")
    .eq("voter_ncid", ncid)
    .maybeSingle<{
      id: string;
      status: string;
      estimated_capacity: number | null;
      asked_amount: number | null;
      committed_amount: number | null;
      donated_amount: number | null;
    }>();

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

      {/* Fundraising link/badge */}
      <section className="mb-6">
        <h2 className="section-label mb-2">Fundraising</h2>
        {prospectRow ? (
          <Link href="/fundraising" className="card card-hover block p-3 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">In pipeline</span>
              <span className={`chip ${prospectRow.status === "donated" ? "chip-success" : prospectRow.status === "declined" ? "chip-danger" : "chip-primary"}`}>
                {prospectRow.status}
              </span>
            </div>
            <div className="mt-1 text-xs text-[var(--color-ink-subtle)]">
              {prospectRow.estimated_capacity ? `Capacity $${prospectRow.estimated_capacity} · ` : ""}
              {prospectRow.asked_amount ? `Asked $${prospectRow.asked_amount} · ` : ""}
              {prospectRow.committed_amount ? `Committed $${prospectRow.committed_amount} · ` : ""}
              {prospectRow.donated_amount ? `Donated $${prospectRow.donated_amount}` : ""}
              {!prospectRow.estimated_capacity && !prospectRow.asked_amount && !prospectRow.committed_amount && !prospectRow.donated_amount && "No amounts set yet"}
            </div>
          </Link>
        ) : (
          <div className="card flex items-center justify-between p-3 text-sm">
            <span className="text-[var(--color-ink-subtle)]">Not in fundraising pipeline.</span>
            <FundraiseButton ncid={ncid} />
          </div>
        )}
      </section>

      {p.household.length > 0 && (
        <section className="mb-6">
          <h2 className="section-label mb-2">Household ({p.household.length})</h2>
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

      <section className="mb-6">
        <h2 className="section-label mb-2">
          Interactions {interactions?.length ? `(${interactions.length})` : ""}
        </h2>
        {!interactions?.length ? (
          <div className="card p-4 text-sm text-[var(--color-ink-subtle)]">No interactions yet.</div>
        ) : (
          <ul className="space-y-2">
            {interactions.map((i) => (
              <li key={i.id} className="card p-4">
                <div className="flex items-baseline justify-between text-xs text-[var(--color-ink-subtle)]">
                  <span>{i.captured_location ?? "—"}</span>
                  <span>{new Date(i.created_at).toLocaleString()}</span>
                </div>
                {i.notes && <p className="mt-1 text-sm text-[var(--color-ink)]">{i.notes}</p>}
                {(i.sentiment || i.issues?.length || i.tags?.length) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {i.sentiment && (
                      <span className={`chip ${sentimentChip(i.sentiment)}`}>
                        {i.sentiment.replace(/_/g, " ")}
                      </span>
                    )}
                    {i.issues?.map((x) => (
                      <span key={`issue-${x}`} className="chip chip-primary">{x}</span>
                    ))}
                    {i.tags?.map((x) => (
                      <span key={`tag-${x}`} className="chip chip-neutral">{x}</span>
                    ))}
                  </div>
                )}
              </li>
            ))}
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


