import { redirect } from "next/navigation";
import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import SettingsForm from "./SettingsForm";

export const dynamic = "force-dynamic";

type Candidate = {
  user_id: string;
  candidate_name: string;
  office: string | null;
  jurisdiction: string | null;
  election_date: string | null;
  fundraising_goal: number | null;
  scratchpad: string | null;
};

export default async function SettingsPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: existing } = await supabase
    .from("candidates")
    .select("user_id, candidate_name, office, jurisdiction, election_date, fundraising_goal, scratchpad")
    .eq("user_id", user.id)
    .maybeSingle<Candidate>();

  return (
    <main className="mx-auto max-w-xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-sm text-slate-500 hover:text-blue-700">Home</Link>
        <h1 className="text-lg font-semibold text-slate-900">Campaign settings</h1>
        <span className="w-12" />
      </header>
      <SettingsForm initial={existing ?? null} userEmail={user.email ?? ""} />
    </main>
  );
}
