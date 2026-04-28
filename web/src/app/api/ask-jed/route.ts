import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

const SYSTEM = `You are JED, a retrieval and organization tool for a local political campaign.

You have access to:
- conversations: every PERSON the candidate has logged a conversation with. One entry per participant per encounter, so a single "talked to the Dasgupta family" debrief produces multiple rows (Pinaki, Anjali, ...).
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

If the user asks an advisory question ("who should I call today?"), reply briefly that you don't make recommendations and suggest what they could ask for instead.

Format:
- Be direct. 2-4 sentences for lookups, or a short numbered/bulleted list for "list / show me / family" questions.
- For family/surname questions, list every match from voter_lookup. Format each line: "1. Pinaki Dasgupta — 123 Main St, Tenafly · DEM (talked 2026-04-01, supportive)" or "2. Anjali Dasgupta — 123 Main St, Tenafly · DEM (no conversation logged)".
- Cite specific names and identifying details when recalling people.
- If the data doesn't contain the answer, say so. Don't invent voters, numbers, issues, or addresses.
- No filler ("Great question!", "Certainly!"). No markdown headers.`;

// Cheap heuristic: only call find_voters_by_name when the question seems
// to mention a name. A capitalized word that isn't a stopword OR a token of
// 4+ chars that isn't a common verb is enough of a signal.
const NAME_SKIP = new Set([
  "the","and","any","all","show","list","find","tell","give","for","from","with",
  "about","who","what","where","when","how","why","this","that","these","those",
  "they","them","their","his","her","our","your","you","have","has","had","was",
  "were","are","can","could","would","should","will","want","need","please",
  "thanks","really","also","jed","voter","voters","people","person","family",
  "households","household","members","member","name","names","last","first",
  "file","files","match","matches","one","two","three","many","some","few",
  "look","search","pull","present","option","options","direct","ones","say",
  "said","want","wanted","look","recall","same","just","only","already","still",
  "again","help","supporter","supporters","undecided","leaning","opposed",
  "supportive","neutral","ward","precinct","district","week","month","year",
  "today","yesterday","tomorrow","date","day","does","did","done","yes","no",
  "if","then","than","but","because","than","most","more","less","fewer","many",
  "talk","talked","spoke","spoken","conversation","conversations",
]);
function questionLikelyMentionsName(q: string): boolean {
  const tokens = q.split(/[^a-zA-Z]+/).filter(Boolean);
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (NAME_SKIP.has(lower)) continue;
    if (t.length >= 3 && /^[A-Z]/.test(t)) return true; // capitalized word
    if (lower.length >= 5) return true; // long-ish non-stopword
  }
  return false;
}

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const limited = await checkRateLimit(supabase, user.id, "ask_jed", 100, 60);
  if (!limited.ok) {
    return Response.json(
      { error: `rate limit: ${limited.message}` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const body = await req.json();
  const question = (body.question as string | undefined)?.trim();
  if (!question) return Response.json({ error: "question required" }, { status: 400 });

  const wantNameLookup = questionLikelyMentionsName(question);

  type ParticipantRow = {
    captured_name: string;
    sentiment: string | null;
    issues: string[] | null;
    tags: string[] | null;
    notes: string | null;
    relationship: string | null;
    interaction_id: string;
    interactions: {
      captured_location: string | null;
      notes: string | null;
      created_at: string;
    } | null;
    voters: {
      first_name: string | null;
      last_name: string | null;
      res_street_address: string | null;
      res_city: string | null;
      party_cd: string | null;
    } | null;
  };

  // Each Supabase builder is awaitable but not a real Promise — wrap so
  // Promise.all is happy and the types narrow on destructure.
  const candP = Promise.resolve(
    supabase
      .from("candidates")
      .select("candidate_name, office, jurisdiction, election_date, race_type")
      .eq("user_id", user.id)
      .maybeSingle(),
  );
  const statsP = Promise.resolve(supabase.rpc("dashboard_stats"));
  const partsP = Promise.resolve(
    supabase
      .from("interaction_participants")
      .select(
        "captured_name, sentiment, issues, tags, notes, relationship, interaction_id, " +
          "interactions(captured_location, notes, created_at), " +
          "voters(first_name, last_name, res_street_address, res_city, party_cd)",
      )
      .limit(800),
  );
  const nameP: Promise<{ data: unknown }> = wantNameLookup
    ? Promise.resolve(supabase.rpc("find_voters_by_name", { q: question, max_results: 30 }))
    : Promise.resolve({ data: [] as unknown[] });

  const [candResult, statsResult, partsResult, nameResult] = await Promise.all([
    candP,
    statsP,
    partsP,
    nameP,
  ]);
  const candidate = (candResult as { data: unknown }).data as Record<string, unknown> | null;
  const stats = (statsResult as { data: unknown }).data;
  const rawParticipants = ((partsResult as { data: unknown }).data ?? []) as ParticipantRow[];
  const nameMatches = ((nameResult as { data: unknown }).data ?? []) as Array<Record<string, unknown>>;

  const daysLeft = candidate && typeof (candidate as { election_date?: string }).election_date === "string"
    ? Math.round(
        (new Date((candidate as { election_date: string }).election_date).getTime() - Date.now()) /
          (1000 * 60 * 60 * 24),
      )
    : null;

  // Sort once on the server; the RPC join doesn't expose interactions.created_at
  // as a top-level orderable column.
  const participantsSorted = rawParticipants.slice().sort((a, b) => {
    const aT = a.interactions?.created_at ?? "";
    const bT = b.interactions?.created_at ?? "";
    return bT.localeCompare(aT);
  }).slice(0, 500);

  const conversations = participantsSorted.map((r) => ({
    name:
      [r.voters?.first_name, r.voters?.last_name].filter(Boolean).join(" ") ||
      r.captured_name,
    relationship: r.relationship,
    where: r.interactions?.captured_location ?? null,
    address: r.voters?.res_street_address ?? null,
    city: r.voters?.res_city ?? null,
    party: r.voters?.party_cd ?? null,
    date: r.interactions?.created_at ? r.interactions.created_at.slice(0, 10) : null,
    sentiment: r.sentiment,
    issues: r.issues ?? [],
    tags: r.tags ?? [],
    notes: r.notes ?? r.interactions?.notes ?? null,
  }));

  const voter_lookup = nameMatches.map((v) => {
    const first = (v.first_name as string | null) ?? null;
    const middle = (v.middle_name as string | null) ?? null;
    const last = (v.last_name as string | null) ?? null;
    return {
      name: [first, middle, last].filter(Boolean).join(" ") || "(no name)",
      address: (v.res_street_address as string | null) ?? null,
      city: (v.res_city as string | null) ?? null,
      party: (v.party_cd as string | null) ?? null,
      birth_year: (v.birth_year as number | null) ?? null,
      ncid: v.ncid as string,
    };
  });

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
