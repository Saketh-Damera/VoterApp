import { getSupabaseServer } from "@/lib/supabase/server";
import AppShell, { type CandidateProfile } from "@/components/AppShell";
import MapClient from "./MapClient";

export const dynamic = "force-dynamic";

export type MapVoter = {
  ncid: string;
  first_name: string | null;
  last_name: string | null;
  res_street_address: string | null;
  res_city: string | null;
  party_cd: string | null;
  lat: number;
  lng: number;
  last_sentiment: string | null;
  priority: number | null;
};

export default async function MapPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("candidates")
    .select("candidate_name, office, jurisdiction, election_date")
    .eq("user_id", user!.id)
    .maybeSingle<CandidateProfile>();

  const { data: raw } = await supabase.rpc("map_contacted_voters");
  const voters = (raw as MapVoter[] | null) ?? [];
  const ungeocoded = await countUngeocoded(supabase, user!.id);

  return (
    <AppShell profile={profile ?? null}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="section-label">Map</h2>
        <p className="text-xs text-[var(--color-ink-subtle)]">
          {voters.length} contacted voters pinned
          {ungeocoded > 0 && ` · ${ungeocoded} not yet geocoded`}
        </p>
      </div>
      <MapClient initialVoters={voters} ungeocoded={ungeocoded} />
    </AppShell>
  );
}

async function countUngeocoded(
  supabase: Awaited<ReturnType<typeof getSupabaseServer>>,
  userId: string,
): Promise<number> {
  const { data } = await supabase
    .from("interaction_participants")
    .select("voter_ncid, interactions!inner(user_id), voters!inner(lat)")
    .eq("interactions.user_id", userId)
    .not("voter_ncid", "is", null);
  type Row = { voter_ncid: string; voters: { lat: number | null } };
  const rows = (data as Row[] | null) ?? [];
  const unique = new Map<string, number | null>();
  for (const r of rows) unique.set(r.voter_ncid, r.voters?.lat ?? null);
  return Array.from(unique.values()).filter((x) => x === null).length;
}
