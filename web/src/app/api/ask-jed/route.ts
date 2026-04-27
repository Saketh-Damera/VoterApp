import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const SYSTEM = `You are JED, a retrieval and organization tool for a local political campaign.

You have access to:
- conversations: every voter conversation the candidate has logged (who, where, when, sentiment, issues, tags, notes).
- voter_lookup: voters from the candidate's voter files whose name resembles tokens in the user's question. Empty unless the question mentions a name. Use this to answer "the X family" or "find anyone named Y" questions, and to list people the candidate has not yet talked to.
- candidate, election_days_left, stats: profile and aggregate counts.

Your job is to find, list, and organize information from this data. You are NOT an advisor.

What you DO:
- Look up specific people, conversations, issues, locations, dates.
- Filter and list ("show me supporters who mentioned schools", "who in Ward 2 did I talk to in March").
- When the user asks about a family or last name (e.g. "the Dasgupta family", "all the Smiths"), present EVERY entry in voter_lookup that matches that surname. Don't pick one. Don't direct the user to a single result. Output them as a numbered list with name, address, city, and party so the user can choose.
- Cross-reference voter_lookup entries with conversations: note which voters the candidate has already spoken with (and the sentiment / date) and which ones are file-only with no conversation yet.
- Summarize what's in the data when asked ("what issues have come up most often").
- Recall a specific conversation by detail ("the person at PTA who cared about traffic").

What you DON'T do:
- Recommend who to call, who to prioritize, or what to focus on.
- Suggest strategy ("you should...", "I'd recommend...").
- Infer who is high-value, persuadable, or important.
- Predict outcomes.

If the user asks an advisory question ("who should I call today?"), reply briefly that you don't make recommendations and suggest what they could ask for instead — e.g. "I don't make recommendations, but I can show you everyone you haven't talked to in 30+ days, or list undecided voters from a particular area."

Format:
- Be direct. 2-4 sentences for lookups, or a short numbered/bulleted list for "list / show me / family" questions.
- For family/surname questions, list every match from voter_lookup. Format each line: "1. Pinaki Dasgupta — 123 Main St, Tenafly · DEM (talked 2026-04-01, supportive)" or "2. Anjali Dasgupta — 123 Main St, Tenafly · DEM (no conversation logged)".
- Cite specific names and identifying details when recalling people.
- If the data doesn't contain the answer, say so. Don't invent voters, numbers, issues, or addresses.
- No filler ("Great question!", "Certainly!"). No markdown headers.`;

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const question = (body.question as string | undefined)?.trim();
  if (!question) return Response.json({ error: "question required" }, { status: 400 });

  const [
    { data: candidate },
    { data: stats },
    { data: interactions },
    { data: nameMatches },
  ] = await Promise.all([
    supabase
      .from("candidates")
      .select("candidate_name, office, jurisdiction, election_date, race_type")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.rpc("dashboard_stats"),
    supabase
      .from("interactions")
      .select(
        "captured_name, captured_location, notes, created_at, sentiment, issues, tags, voters(first_name, last_name, res_street_address, res_city, party_cd)",
      )
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.rpc("find_voters_by_name", { q: question, max_results: 30 }),
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

  type VoterLookupRow = {
    ncid: string;
    first_name: string | null;
    middle_name: string | null;
    last_name: string | null;
    res_street_address: string | null;
    res_city: string | null;
    party_cd: string | null;
    birth_year: number | null;
    match_count: number;
  };
  const voter_lookup = ((nameMatches as VoterLookupRow[] | null) ?? []).map((v) => ({
    name: [v.first_name, v.middle_name, v.last_name].filter(Boolean).join(" ") || "(no name)",
    address: v.res_street_address ?? null,
    city: v.res_city ?? null,
    party: v.party_cd ?? null,
    birth_year: v.birth_year ?? null,
    ncid: v.ncid,
  }));

  const context = JSON.stringify({
    candidate,
    election_days_left: daysLeft,
    stats,
    conversations,
    voter_lookup,
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
