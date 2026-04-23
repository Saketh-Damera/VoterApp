import { getSupabaseServer } from "@/lib/supabase/server";
import AppHeader, { type CandidateProfile } from "@/components/AppHeader";
import TodosClient from "./TodosClient";

export const dynamic = "force-dynamic";

export type Todo = {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  status: "pending" | "done";
  created_at: string;
  completed_at: string | null;
};

export default async function TodosPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("candidates")
    .select("candidate_name, office, jurisdiction, election_date")
    .eq("user_id", user!.id)
    .maybeSingle<CandidateProfile>();

  const { data: todos } = await supabase
    .from("todos")
    .select("*")
    .order("status", { ascending: true })
    .order("due_date", { ascending: true, nullsFirst: false })
    .returns<Todo[]>();

  return (
    <main className="mx-auto max-w-3xl px-5 pb-16 pt-6">
      <AppHeader profile={profile ?? null} />
      <h2 className="section-label mb-3">To-dos</h2>
      <TodosClient initial={todos ?? []} />
    </main>
  );
}
