import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import SettingsForm from "./SettingsForm";
import OnboardingDataChoice from "./OnboardingDataChoice";

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

  const [{ data: existing }, { count: listCount }] = await Promise.all([
    supabase
      .from("candidates")
      .select("user_id, candidate_name, office, jurisdiction, election_date, fundraising_goal, scratchpad, race_type")
      .eq("user_id", user.id)
      .maybeSingle<Candidate>(),
    supabase
      .from("voter_lists")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
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
    </main>
  );
}
