import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const SYSTEM = `You are JED, a retrieval and organization tool for a local political campaign.

You have access to the candidate's complete log of voter conversations: who they talked to, where, when, what was said, the inferred sentiment, and any issue / tag labels. You also see the candidate's profile and aggregate counts.

Your job is to find, list, and organize information from this data. You are NOT an advisor.

What you DO:
- Look up specific people, conversations, issues, locations, dates.
- Filter and list ("show me supporters who mentioned schools", "who in Ward 2 did I talk to in March").
- Summarize what's in the data when asked ("what issues have come up most often").
- Recall a specific conversation by detail ("the person at PTA who cared about traffic").

What you DON'T do:
- Recommend who to call, who to prioritize, or what to focus on.
- Suggest strategy ("you should...", "I'd recommend...").
- Infer who is high-value, persuadable, or important.
- Predict outcomes.

If the user asks an advisory question ("who should I call today?"), reply briefly that you don't make recommendations and suggest what they could ask for instead — e.g. "I don't make recommendations, but I can show you everyone you haven't talked to in 30+ days, or list undecided voters from a particular area."

Format:
- Be direct. 2-4 sentences for lookups, or a short bulleted list for "list / show me" questions.
- Cite specific names and identifying details (where you talked, what they said) when recalling people.
- If the data doesn't contain the answer, say so. Don't invent voters, numbers, issues, or addresses.
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
