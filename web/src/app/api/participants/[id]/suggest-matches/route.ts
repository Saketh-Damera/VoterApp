import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const SuggestSchema = z.object({
  reasoning: z.string().describe("One short sentence explaining how you decided."),
  candidates: z.array(z.object({
    ncid: z.string().describe("The exact ncid value from the candidate pool — never invented."),
    why: z.string().describe("One short phrase explaining why this is the best fit (matching surname, address near the conversation location, household member of someone they talked to before, etc.)."),
  })).describe("Up to 3 entries, ranked best-first. Empty if nothing in the candidate pool plausibly matches."),
});

const SYSTEM = `You help a candidate link an unmatched voter conversation to a row in the voter file.

You will see:
- captured_name: the name as the candidate spoke it (often a partial or fuzzy spelling).
- conversation: location, full notes, and other people in the same conversation.
- candidate_pool: voters from the candidate's lists that fuzzy-matched the captured_name OR share an address with someone the candidate already talked to.

Pick up to 3 candidates that plausibly match. Use:
- Surname / first-name overlap.
- Same address as another participant in the same conversation.
- Consistency with the conversation notes (a voter who already came up in another debrief, a parent at the school the candidate met at, etc.).

If nothing in the pool fits, return candidates: [].

Never invent an ncid. Use only ncid values that are present in candidate_pool.`;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  // 1) Fetch the participant + parent interaction (RLS scopes both)
  const { data: participant, error: pErr } = await supabase
    .from("interaction_participants")
    .select("id, captured_name, voter_ncid, interaction_id")
    .eq("id", id)
    .single();
  if (pErr || !participant) {
    return Response.json({ error: pErr?.message ?? "participant not found" }, { status: 404 });
  }

  const { data: interaction, error: iErr } = await supabase
    .from("interactions")
    .select("id, captured_location, notes, created_at")
    .eq("id", participant.interaction_id)
    .single();
  if (iErr || !interaction) {
    return Response.json({ error: "parent interaction missing" }, { status: 500 });
  }

  // 2) Co-participants from the same conversation (gives household / address signal)
  const { data: coParticipants } = await supabase
    .from("interaction_participants")
    .select("captured_name, voter_ncid, voters(first_name, last_name, res_street_address, res_city)")
    .eq("interaction_id", participant.interaction_id)
    .neq("id", id);

  // 3) Build the candidate pool: fuzzy-match on captured_name + anyone at the
  //    address of a matched co-participant.
  const fuzzyName = participant.captured_name ?? "";
  const { data: nameHits } = fuzzyName.length >= 2
    ? await supabase.rpc("find_voters_by_name", { q: fuzzyName, max_results: 10 })
    : { data: [] };

  type VoterMini = {
    first_name: string | null;
    last_name: string | null;
    res_street_address: string | null;
    res_city: string | null;
  };
  type CoP = {
    captured_name: string;
    voter_ncid: string | null;
    voters: VoterMini | VoterMini[] | null;
  };
  const cop = (coParticipants ?? []) as unknown as CoP[];
  const coVoter = (c: CoP): VoterMini | null => {
    if (!c.voters) return null;
    return Array.isArray(c.voters) ? c.voters[0] ?? null : c.voters;
  };
  const addressKeys = cop
    .map(coVoter)
    .filter((v): v is VoterMini => !!v && !!v.res_street_address)
    .map((v) => ({ addr: v.res_street_address!, city: v.res_city ?? "" }));

  let addressHits: Array<Record<string, unknown>> = [];
  if (addressKeys.length) {
    const orFilter = addressKeys
      .map((k) => `and(res_street_address.eq.${JSON.stringify(k.addr)},res_city.eq.${JSON.stringify(k.city)})`)
      .join(",");
    const { data } = await supabase
      .from("voters")
      .select("ncid, first_name, last_name, res_street_address, res_city, party_cd, age")
      .or(orFilter)
      .limit(20);
    addressHits = data ?? [];
  }

  // Dedupe by ncid
  type Pool = {
    ncid: string;
    first_name: string | null;
    last_name: string | null;
    res_street_address: string | null;
    res_city: string | null;
    party_cd?: string | null;
    age?: number | null;
  };
  const poolMap = new Map<string, Pool>();
  for (const r of (nameHits as Pool[] | null) ?? []) poolMap.set(r.ncid, r);
  for (const r of addressHits as Pool[]) poolMap.set(r.ncid, r);
  const pool = Array.from(poolMap.values()).slice(0, 30);

  if (pool.length === 0) {
    return Response.json({
      ok: true,
      reasoning: "No nearby voters matched the name or any co-participant's address.",
      candidates: [],
      pool: [],
    });
  }

  // 4) Ask Claude to rank
  const userContent = JSON.stringify({
    captured_name: participant.captured_name,
    conversation: {
      location: interaction.captured_location,
      notes: interaction.notes,
      date: interaction.created_at,
      co_participants: cop.map((c) => {
        const v = coVoter(c);
        return {
          captured_name: c.captured_name,
          voter: v
            ? {
                name: [v.first_name, v.last_name].filter(Boolean).join(" "),
                address: v.res_street_address,
                city: v.res_city,
              }
            : null,
        };
      }),
    },
    candidate_pool: pool.map((p) => ({
      ncid: p.ncid,
      name: [p.first_name, p.last_name].filter(Boolean).join(" "),
      address: p.res_street_address,
      city: p.res_city,
      party: p.party_cd ?? null,
      age: p.age ?? null,
    })),
  });

  try {
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: process.env.JED_MODEL ?? "claude-haiku-4-5",
      max_tokens: 700,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
      output_config: { format: zodOutputFormat(SuggestSchema) },
    });
    const parsed = response.parsed_output;
    if (!parsed) throw new Error("no parsed output");
    // Filter to ncids that actually exist in the pool (Claude guard)
    const valid = parsed.candidates.filter((c) => poolMap.has(c.ncid));
    return Response.json({
      ok: true,
      reasoning: parsed.reasoning,
      candidates: valid.map((c) => ({ ...poolMap.get(c.ncid)!, why: c.why })),
      pool,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
