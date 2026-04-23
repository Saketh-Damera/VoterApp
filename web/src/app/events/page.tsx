import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import AppShell, { type CandidateProfile } from "@/components/AppShell";
import NewEventForm from "./NewEventForm";

export const dynamic = "force-dynamic";

type Ev = {
  id: string;
  title: string;
  location: string | null;
  event_date: string | null;
  created_at: string;
};

export default async function EventsPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("candidates")
    .select("candidate_name, office, jurisdiction, election_date")
    .eq("user_id", user!.id)
    .maybeSingle<CandidateProfile>();

  const { data: events } = await supabase
    .from("events")
    .select("id, title, location, event_date, created_at")
    .order("event_date", { ascending: false, nullsFirst: false })
    .returns<Ev[]>();

  return (
    <AppShell profile={profile ?? null}>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section>
          <h2 className="section-label mb-3">Events</h2>
          {!events?.length ? (
            <div className="card p-5 text-sm text-[var(--color-ink-subtle)]">
              No events yet. Add a house party, coffee, or town hall on the right.
            </div>
          ) : (
            <ul className="space-y-2">
              {events.map((e) => (
                <li key={e.id} className="card card-hover p-4">
                  <Link href={`/events/${e.id}`} className="block">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{e.title}</span>
                      <span className="text-xs text-[var(--color-ink-subtle)]">
                        {e.event_date
                          ? new Date(e.event_date).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
                          : "no date"}
                      </span>
                    </div>
                    {e.location && <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">{e.location}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside>
          <h2 className="section-label mb-3">New event</h2>
          <NewEventForm />
        </aside>
      </div>
    </AppShell>
  );
}
