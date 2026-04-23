import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import AppShell, { type CandidateProfile } from "@/components/AppShell";

export const dynamic = "force-dynamic";

type Connector = {
  ncid: string;
  first_name: string | null;
  last_name: string | null;
  res_city: string | null;
  degree: number;
  household_ties: number;
  event_ties: number;
  connections: Array<{
    ncid: string;
    reason: "household" | "event";
    detail: string | null;
  }>;
};

type Stats = {
  edges: number;
  household_edges: number;
  event_edges: number;
  connected_people: number;
  total_contacted: number;
};

export default async function NetworkPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("candidates")
    .select("candidate_name, office, jurisdiction, election_date")
    .eq("user_id", user!.id)
    .maybeSingle<CandidateProfile>();

  const [{ data: connectorsRaw }, { data: statsRaw }] = await Promise.all([
    supabase.rpc("super_connectors", { p_limit: 20 }),
    supabase.rpc("network_stats"),
  ]);

  const connectors = (connectorsRaw as Connector[] | null) ?? [];
  const stats = (statsRaw as Stats | null) ?? null;

  // Resolve names for the other sides of each connection
  const linkedNcids = new Set<string>();
  for (const c of connectors) {
    for (const e of c.connections) linkedNcids.add(e.ncid);
  }
  const { data: names } =
    linkedNcids.size > 0
      ? await supabase
          .from("voters")
          .select("ncid, first_name, last_name")
          .in("ncid", Array.from(linkedNcids))
      : { data: [] as { ncid: string; first_name: string | null; last_name: string | null }[] };
  const nameByNcid = new Map(names?.map((n) => [n.ncid, [n.first_name, n.last_name].filter(Boolean).join(" ")]));

  return (
    <AppShell profile={profile ?? null}>
      <h2 className="section-label mb-3">Network analysis</h2>
      <p className="mb-5 text-sm text-[var(--color-ink-subtle)]">
        Derived connections between the voters you&apos;ve talked to. Two voters are linked if they share
        a residential address (household) or attended the same event with you.
      </p>

      {stats && (
        <section className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Contacted" value={String(stats.total_contacted)} />
          <Stat label="In network" value={String(stats.connected_people)} />
          <Stat label="Household ties" value={String(stats.household_edges)} />
          <Stat label="Event ties" value={String(stats.event_edges)} />
        </section>
      )}

      {connectors.length === 0 ? (
        <div className="card p-5 text-sm text-[var(--color-ink-subtle)]">
          No connections yet. Connections appear once you&apos;ve talked to 2+ people who share an address,
          or once attendees overlap across events.
        </div>
      ) : (
        <section>
          <h3 className="section-label mb-3">Super-connectors</h3>
          <ul className="space-y-3">
            {connectors.map((c) => (
              <li key={c.ncid} className="card p-4">
                <div className="flex items-baseline justify-between">
                  <Link href={`/people/${c.ncid}`} className="font-medium hover:text-[var(--color-primary)]">
                    {[c.first_name, c.last_name].filter(Boolean).join(" ")}
                    {c.res_city && (
                      <span className="ml-2 text-xs text-[var(--color-ink-subtle)]">{c.res_city}</span>
                    )}
                  </Link>
                  <span className="chip chip-primary">
                    {c.degree} {c.degree === 1 ? "connection" : "connections"}
                  </span>
                </div>
                <div className="mt-1 text-xs text-[var(--color-ink-subtle)]">
                  {c.household_ties} household · {c.event_ties} via events
                </div>
                <ul className="mt-3 space-y-1">
                  {c.connections.map((edge) => (
                    <li key={`${edge.ncid}-${edge.reason}-${edge.detail ?? ""}`} className="text-xs">
                      <Link
                        href={`/people/${edge.ncid}`}
                        className="hover:text-[var(--color-primary)]"
                      >
                        {nameByNcid.get(edge.ncid) || edge.ncid}
                      </Link>
                      <span className="ml-2 text-[var(--color-ink-subtle)]">
                        via {edge.reason}{edge.detail ? ` (${edge.detail})` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-3 py-2">
      <div className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-ink-subtle)]">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-[var(--color-ink)]">{value}</div>
    </div>
  );
}
