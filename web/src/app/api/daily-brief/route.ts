import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { generateDailyBrief } from "@/lib/ai/dailyBrief";

export const runtime = "nodejs";

export async function POST(_req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const [{ data: candidate }, { data: statsData }, { data: topAction }] = await Promise.all([
    supabase.from("candidates").select("candidate_name, office, election_date").eq("user_id", user.id).maybeSingle(),
    supabase.rpc("dashboard_stats"),
    supabase.rpc("top_priority_actions", { p_limit: 1 }),
  ]);

  type Stats = {
    interactions_total: number;
    interactions_7d: number;
    supportive_count: number;
    undecided_count: number;
  };
  const stats = (statsData as Stats | null) ?? {
    interactions_total: 0,
    interactions_7d: 0,
    supportive_count: 0,
    undecided_count: 0,
  };

  type TopAction = { first_name: string | null; last_name: string | null; message: string | null };
  const top = Array.isArray(topAction) ? (topAction[0] as TopAction | undefined) : null;

  // Recent issues/sentiments for the week. issues + sentiment are now per
  // participant; pull every participant whose parent interaction is in the
  // last 7 days. Filter to user-owned via the join (RLS does the actual gate).
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from("interaction_participants")
    .select("issues, sentiment, interactions!inner(user_id, created_at)")
    .eq("interactions.user_id", user.id)
    .gt("interactions.created_at", weekAgo);

  type Recent = { issues: string[] | null; sentiment: string | null };
  const rowsRecent = (recent as Recent[] | null) ?? [];
  const issues: string[] = [];
  const sentiments: string[] = [];
  for (const r of rowsRecent) {
    if (r.issues) issues.push(...r.issues);
    if (r.sentiment) sentiments.push(r.sentiment);
  }

  const electionDays = candidate?.election_date
    ? Math.round((new Date(candidate.election_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  try {
    const brief = await generateDailyBrief({
      candidate: {
        name: candidate?.candidate_name ?? "you",
        office: candidate?.office ?? null,
        election_days: electionDays,
      },
      counts: {
        interactions_7d: stats.interactions_7d,
        interactions_total: stats.interactions_total,
        supportive: stats.supportive_count,
        undecided: stats.undecided_count,
        top_priority_name: top ? [top.first_name, top.last_name].filter(Boolean).join(" ") : null,
        top_priority_reason: top?.message ?? null,
      },
      recent_issues: issues,
      recent_sentiments: sentiments,
    });
    return Response.json({ ok: true, brief });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
