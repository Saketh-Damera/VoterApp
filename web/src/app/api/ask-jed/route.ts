import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const SYSTEM = `You are JED, the assistant for a first-time local political candidate.

The user will ask you a question. You have a snapshot of their current campaign data (candidate profile, weekly stats, recent conversations with voters, pending follow-ups, and to-dos). Answer from that data.

Rules:
- Be direct. 2–4 sentences is usually enough.
- If the data doesn't support an answer, say so honestly. Don't invent voters, numbers, or issues.
- Use specific names when they appear in the data ("Maria Hernandez is leaning supportive...").
- If the user asks for a recommendation, give one concrete next action.
- No filler ("Great question!", "Certainly!").
- No markdown headers or bullet lists unless the question is clearly a list question ("list my supporters") — prefer flowing prose.`;

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const question = (body.question as string | undefined)?.trim();
  if (!question) return Response.json({ error: "question required" }, { status: 400 });

  const [{ data: candidate }, { data: stats }, { data: actions }, { data: interactions }, { data: todos }] =
    await Promise.all([
      supabase.from("candidates").select("candidate_name, office, jurisdiction, election_date, race_type, fundraising_goal").eq("user_id", user.id).maybeSingle(),
      supabase.rpc("dashboard_stats"),
      supabase.rpc("top_priority_actions", { p_limit: 5 }),
      supabase
        .from("interactions")
        .select("captured_name, notes, created_at, sentiment, issues, tags, voters(first_name, last_name, res_city, party_cd)")
        .order("created_at", { ascending: false })
        .limit(15),
      supabase.from("todos").select("title, status, due_date").eq("status", "pending").order("due_date"),
    ]);

  const daysLeft = candidate?.election_date
    ? Math.round(
        (new Date(candidate.election_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      )
    : null;

  const context = JSON.stringify({
    candidate,
    election_days_left: daysLeft,
    stats,
    pending_follow_ups: actions,
    recent_conversations: interactions,
    open_todos: todos,
  });

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: process.env.JED_MODEL ?? "claude-haiku-4-5",
      max_tokens: 800,
      system: [
        { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        { role: "user", content: `Campaign snapshot:\n${context}\n\n---\n\nQuestion: ${question}` },
      ],
    });
    const answer = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return Response.json({ ok: true, answer });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
