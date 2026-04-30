import { getSupabaseServer } from "@/lib/supabase/server";
import AppShell, { type CandidateProfile } from "@/components/AppShell";
import MeetingsClient from "./MeetingsClient";

export const dynamic = "force-dynamic";

export type MeetingRow = {
  id: string;
  title: string;
  body: string | null;
  meeting_date: string | null;
  duration_min: number | null;
  location: string | null;
  attendees: string[] | null;
  tags: string[] | null;
  created_at: string;
};

export default async function MeetingsPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("candidates")
    .select("candidate_name, office, jurisdiction, election_date")
    .eq("user_id", user!.id)
    .maybeSingle<CandidateProfile>();

  const { data: meetings } = await supabase
    .from("meeting_notes")
    .select("id, title, body, meeting_date, duration_min, location, attendees, tags, created_at")
    .order("meeting_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .returns<MeetingRow[]>();

  return (
    <AppShell profile={profile ?? null}>
      <header className="mb-6 border-b border-[var(--color-border)] pb-6">
        <div className="flex items-baseline justify-between">
          <h1 className="page-title">Meetings &amp; notes</h1>
        </div>
        <p className="page-subtitle mt-2">
          Coffee chats, debate prep, strategy syncs. Each meeting can be downloaded
          as an .ics file and imported into Google Calendar / Apple Calendar / Outlook.
        </p>
      </header>
      <MeetingsClient initial={meetings ?? []} />
    </AppShell>
  );
}
