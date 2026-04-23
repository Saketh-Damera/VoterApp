import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import PersonAIActions from "./PersonAIActions";

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

  const { data: priorityData } = await supabase.rpc("voter_priority", { p_ncid: ncid });
  const priority = typeof priorityData === "number" ? priorityData : null;

  const fullName = [p.voter.first_name, p.voter.middle_name, p.voter.last_name]
    .filter(Boolean)
    .join(" ");

  const turnoutTier = turnoutCategory(p.turnout);

  return (
    <main className="mx-auto max-w-2xl px-5 pb-16 pt-6">
      <header className="mb-5 border-b border-[var(--color-border)] pb-4">
        <Link href="/" className="btn-ghost">← Home</Link>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
            {fullName}
          </h1>
          {priority !== null && (
            <span className={`chip ${priorityChip(priority)}`}>
              priority {Math.round(priority)}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-[var(--color-ink-subtle)]">
          {p.voter.res_street_address}
          {p.voter.res_city ? ", " + p.voter.res_city : ""}
          {p.voter.res_zip ? " " + p.voter.res_zip : ""}
        </p>
        <div className="mt-3">
          <PersonAIActions ncid={ncid} />
        </div>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 text-sm">
        <Fact label="Party" value={p.voter.party_cd} />
        <Fact label="Age" value={p.voter.age != null ? String(p.voter.age) : null} />
        <Fact label="Precinct" value={p.voter.precinct_desc} />
        <Fact label="Registered" value={p.voter.registr_dt} />
        <Fact
          label="Turnout"
          value={
            p.turnout
              ? `${turnoutTier} — ${p.turnout.generals_voted} general, ${p.turnout.elections_voted} total`
              : "—"
          }
        />
        <Fact label="Last voted" value={p.turnout?.last_voted ?? null} />
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

function turnoutCategory(t: Turnout): string {
  if (!t) return "Low";
  if (t.generals_voted >= 3) return "High";
  if (t.generals_voted >= 1) return "Medium";
  return "Low";
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

function priorityChip(p: number): string {
  if (p >= 50) return "chip-danger";
  if (p >= 25) return "chip-warning";
  if (p >= 10) return "chip-primary";
  return "chip-neutral";
}
