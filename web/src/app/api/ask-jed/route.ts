import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const SYSTEM = `You are JED, the assistant for a first-time local political candidate.

You have access to the candidate's complete log of voter conversations: who they talked to, where, when, what was said, the inferred sentiment, and any issue / tag labels. You also see the candidate's profile and weekly aggregate stats.

Answer the user's question from that data. Common queries:
- "Who was it I talked to at the PTA meeting who cared about Oak Street traffic?"
- "Which voters mentioned schools in the last week?"
- "Which supportive contacts haven't I heard back from?"

Rules:
- Be direct. 2–4 sentences is usually enough.
- When recalling a person, give name + the most identifying detail (where you talked, the issue) so the candidate recognizes them.
- If the data doesn't support an answer, say so honestly. Don't invent voters, numbers, or issues.
- If the question is a list question, return a short bulleted list with one line per person.
- No filler ("Great question!", "Certainly!"). No markdown headers.`;

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const question = (body.question as string | undefined)?.trim();
  if (!question) return Response.json({ error: "question required" }, { status: 400 });

  const [{ data: candidate }, { data: stats }, { data: interactions }] = await Promise.all([
    supabase
      .from("candidates")
      .select("candidate_name, office, jurisdiction, election_date, race_type")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.rpc("dashboard_stats"),
    // Pull every conversation the candidate has logged. For a first-time
    // local campaign this is hundreds, not thousands.
    supabase
      .from("interactions")
      .select(
        "captured_name, captured_location, notes, created_at, sentiment, issues, tags, voters(first_name, last_name, res_street_address, res_city, party_cd)",
      )
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const daysLeft = candidate?.election_date
    ? Math.round(
        (new Date(candidate.election_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      )
    : null;

  type Row = {
    captured_name: string;
    captured_location: string | null;
    notes: string | null;
    created_at: string;
    sentiment: string | null;
    issues: string[] | null;
    tags: string[] | null;
    voters: {
      first_name: string | null;
      last_name: string | null;
      res_street_address: string | null;
      res_city: string | null;
      party_cd: string | null;
    } | null;
  };
  const conversations = ((interactions as Row[] | null) ?? []).map((r) => ({
    name:
      [r.voters?.first_name, r.voters?.last_name].filter(Boolean).join(" ") ||
      r.captured_name,
    where: r.captured_location ?? null,
    address: r.voters?.res_street_address ?? null,
    city: r.voters?.res_city ?? null,
    party: r.voters?.party_cd ?? null,
    date: r.created_at.slice(0, 10),
    sentiment: r.sentiment ?? null,
    issues: r.issues ?? [],
    tags: r.tags ?? [],
    notes: r.notes ?? null,
  }));

  const context = JSON.stringify({
    candidate,
    election_days_left: daysLeft,
    stats,
    conversations,
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
