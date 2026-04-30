import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import SettingsForm from "./SettingsForm";
import OnboardingDataChoice from "./OnboardingDataChoice";
import VolunteerGroupsPanel from "./VolunteerGroupsPanel";

export const dynamic = "force-dynamic";

type Candidate = {
  user_id: string;
  candidate_name: string;
  office: string | null;
  jurisdiction: string | null;
  election_date: string | null;
  fundraising_goal: number | null;
  scratchpad: string | null;
  race_type: string | null;
};

export default async function SettingsPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  type VG = { id: string; name: string; description: string | null; created_at: string };
  type VM = { id: string; user_id: string; role: string; joined_at: string };
  type VI = { id: string; email: string | null; invite_code: string; accepted_at: string | null; expires_at: string };
  const [
    { data: existing },
    { count: listCount },
    { data: ownedGroups },
  ] = await Promise.all([
    supabase
      .from("candidates")
      .select("user_id, candidate_name, office, jurisdiction, election_date, fundraising_goal, scratchpad, race_type")
      .eq("user_id", user.id)
      .maybeSingle<Candidate>(),
    supabase
      .from("voter_lists")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
    supabase
      .from("volunteer_groups")
      .select("id, name, description, created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .returns<VG[]>(),
  ]);

  // Pull memberships + invites for the user's owned groups so the panel
  // can render them. Two more queries instead of trying to do nested
  // joins (PostgREST nesting + RLS gets gnarly).
  const groupIds = (ownedGroups ?? []).map((g) => g.id);
  const [{ data: memberships }, { data: invites }] = await Promise.all([
    groupIds.length
      ? supabase
          .from("volunteer_memberships")
          .select("id, group_id, user_id, role, joined_at")
          .in("group_id", groupIds)
      : Promise.resolve({ data: [] as Array<VM & { group_id: string }> }),
    groupIds.length
      ? supabase
          .from("volunteer_invites")
          .select("id, group_id, email, invite_code, accepted_at, expires_at, created_at")
          .in("group_id", groupIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Array<VI & { group_id: string; created_at: string }> }),
  ]);

  const isFirstRun = !existing;
  const hasOwnList = (listCount ?? 0) > 0;

  return (
    <main className="mx-auto max-w-xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-sm text-slate-500 hover:text-blue-700">
          Home
        </Link>
        <h1 className="text-lg font-semibold text-slate-900">
          {isFirstRun ? "Welcome to JED" : "Settings"}
        </h1>
        <span className="w-12" />
      </header>

      {isFirstRun && (
        <div className="mb-6 rounded-md border border-[var(--color-accent-soft)] bg-[var(--color-accent-soft)] p-4 text-sm">
          <strong className="text-[var(--color-primary)]">You&apos;re almost set up.</strong> Fill in your
          candidate details below, then choose how JED will find voters:
          upload your state&apos;s voter file, or start with the North Carolina
          (Durham) sample.
        </div>
      )}

      <SettingsForm initial={existing ?? null} userEmail={user.email ?? ""} />

      <hr className="my-8 border-[var(--color-border)]" />

      <section>
        <h2 className="mb-1 text-base font-semibold text-[var(--color-ink)]">Voter data</h2>
        <p className="mb-4 text-sm text-[var(--color-ink-subtle)]">
          Where will JED find people to match your notes against?
        </p>
        <OnboardingDataChoice hasOwnList={hasOwnList} />
      </section>

      <hr className="my-8 border-[var(--color-border)]" />

      <section>
        <h2 className="mb-1 text-base font-semibold text-[var(--color-ink)]">Volunteers</h2>
        <p className="mb-4 text-sm text-[var(--color-ink-subtle)]">
          Create a volunteer group, generate an invite link, and share it with
          campaign volunteers. They sign up with their own email; conversations
          they log are tagged with their name and rolled into your contact list.
        </p>
        <VolunteerGroupsPanel
          groups={ownedGroups ?? []}
          memberships={(memberships as Array<{ id: string; group_id: string; user_id: string; role: string; joined_at: string }>) ?? []}
          invites={(invites as Array<{ id: string; group_id: string; email: string | null; invite_code: string; accepted_at: string | null; expires_at: string }>) ?? []}
        />
      </section>
    </main>
  );
}
