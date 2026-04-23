import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import AppShell, { type CandidateProfile } from "@/components/AppShell";
import EventDetailClient from "./EventDetailClient";

export const dynamic = "force-dynamic";

export type Ev = {
  id: string;
  title: string;
  location: string | null;
  event_date: string | null;
  notes: string | null;
  brief: string | null;
  brief_generated_at: string | null;
};

export type Attendee = {
  voter_ncid: string;
  first_name: string | null;
  last_name: string | null;
  res_city: string | null;
  party_cd: string | null;
};

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: profile }, { data: event }, { data: rawAttendees }] = await Promise.all([
    supabase.from("candidates").select("candidate_name, office, jurisdiction, election_date").eq("user_id", user!.id).maybeSingle<CandidateProfile>(),
    supabase.from("events").select("*").eq("id", id).maybeSingle<Ev>(),
    supabase
      .from("event_attendees")
      .select("voter_ncid, voters(first_name, last_name, res_city, party_cd)")
      .eq("event_id", id),
  ]);
  if (!event) return notFound();

  type RawRow = {
    voter_ncid: string;
    voters: { first_name: string | null; last_name: string | null; res_city: string | null; party_cd: string | null } | null;
  };
  const attendees: Attendee[] = ((rawAttendees as RawRow[] | null) ?? []).map((r) => ({
    voter_ncid: r.voter_ncid,
    first_name: r.voters?.first_name ?? null,
    last_name: r.voters?.last_name ?? null,
    res_city: r.voters?.res_city ?? null,
    party_cd: r.voters?.party_cd ?? null,
  }));

  return (
    <AppShell profile={profile ?? null}>
      <div className="mb-4">
        <Link href="/events" className="btn-ghost text-xs">Back to events</Link>
      </div>
      <EventDetailClient event={event} initialAttendees={attendees} />
    </AppShell>
  );
}
