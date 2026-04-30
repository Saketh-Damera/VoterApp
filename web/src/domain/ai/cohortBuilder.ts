// Natural-language cohort builder. Takes a free-text description of a voter
// segment, asks Claude to translate to a structured filter spec, then runs
// build_cohort() in Postgres for the actual matching. The model NEVER builds
// SQL — it produces a JSON spec, we run a parameterized RPC.

import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ai } from "./anthropic";
import { ExternalServiceError } from "@/domain/errors";
import { log } from "@/lib/logger";

// Filter spec returned by the model. Mirrors the build_cohort RPC signature.
// We use empty string + null for optional fields because Anthropic structured
// output had a 16-union-field cap historically; safer to default to strings.
export const CohortFilter = z.object({
  age_min: z.number().int().nullable(),
  age_max: z.number().int().nullable(),
  party: z.enum(["DEM", "REP", "UNA", "LIB", "GRE", "CST", ""]).describe(
    "Party affiliation. Empty if not specified.",
  ),
  city: z.string().describe("City name. Empty if not specified."),
  zip: z.string().describe("ZIP code. Empty if not specified."),
  precinct: z.string().describe("Substring match against precinct_desc."),
  municipality: z.string().describe("Substring match against municipality_desc."),
  state: z.string().describe("State abbreviation. Empty if not specified."),
  voter_status: z.enum(["ACTIVE", "INACTIVE", "REMOVED", "PENDING", ""]).describe(
    "Voter registration status. Empty if not specified.",
  ),
  voted_in: z.string().describe(
    "Substring of election_desc — e.g. '2024 PRIMARY', 'GENERAL', 'MUNICIPAL'. Empty if not specified.",
  ),
  voted_party: z.enum(["DEM", "REP", "UNA", ""]).describe(
    "Party they voted in (mostly meaningful for primaries). Empty if not specified.",
  ),
  voted_after: z.string().describe(
    "ISO date YYYY-MM-DD; only count votes on/after this date. Empty if not specified.",
  ),
  voted_before: z.string().describe(
    "ISO date YYYY-MM-DD; only count votes on/before this date. Empty if not specified.",
  ),
  min_total_votes: z.number().int().nullable().describe(
    "Voter must have voted at least this many times overall.",
  ),
  min_relevant_votes: z.number().int().nullable().describe(
    "Voter must have voted at least this many times in elections matching voted_in/voted_party/voted_after/voted_before.",
  ),
});
export type CohortFilter = z.infer<typeof CohortFilter>;

const SYSTEM = `You convert a candidate's plain-English description of a voter cohort into a structured JSON filter.

Available fields and their meaning:
- age_min / age_max: numeric, inclusive. null when not mentioned.
- party: DEM, REP, UNA (unaffiliated), LIB, GRE, CST. "" when not specified.
- city: matches voters whose res_city ILIKE the value. "" when not specified.
- zip: exact match on res_zip.
- precinct: substring match on precinct_desc.
- municipality: substring match on municipality_desc.
- state: 2-letter state code; restricts to lists tagged with that state. "" when not specified.
- voter_status: ACTIVE / INACTIVE / REMOVED / PENDING.
- voted_in: substring of the election description. Use 'PRIMARY' for primaries, 'GENERAL' for general, 'MUNICIPAL' for municipal, etc. You can include the year, e.g. '2024 PRIMARY'.
- voted_party: only for primaries — DEM / REP / UNA. The party ballot they pulled.
- voted_after / voted_before: ISO YYYY-MM-DD dates. Use to constrain the window.
- min_total_votes: voter must have voted at least N times overall (any election).
- min_relevant_votes: voter must have voted at least N times in elections matching the voted_in / voted_party / voted_after / voted_before window above. Use this to find "people who voted in 2 of the last 3 primaries", etc.

Rules:
- Be faithful. If the description doesn't mention age, leave age_min and age_max null.
- "registered Democrats" → party = "DEM".
- "voted in the 2024 primary" → voted_in = "PRIMARY", voted_after = "2024-01-01", voted_before = "2024-12-31", min_relevant_votes = 1.
- "Democrats who voted in 2 of the last 3 primaries" (and today is around 2026) → party=DEM, voted_in=PRIMARY, voted_after = three years before today, min_relevant_votes = 2.
- "Tenafly voters under 40" → city = "Tenafly", age_max = 39 (interpret "under 40" as < 40 → max 39).
- For state inference (e.g. "in Durham"), do NOT guess a state code unless explicitly named.
- Return JSON exactly matching the schema. Use empty string "" for unspecified text fields and null for unspecified numbers.`;

export async function describeToFilter(description: string): Promise<CohortFilter> {
  const today = new Date().toISOString().slice(0, 10);

  const response = await ai.parse("cohortBuilder.describe", {
    model: process.env.JED_MODEL ?? "claude-haiku-4-5",
    max_tokens: 800,
    system: [
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
      { type: "text", text: `Today's date is ${today}.` },
    ],
    messages: [{ role: "user", content: description }],
    output_config: { format: zodOutputFormat(CohortFilter) },
  });
  if (!response.parsed_output) {
    throw new ExternalServiceError("Claude returned no cohort filter", "anthropic");
  }
  return response.parsed_output;
}

export type CohortRow = {
  ncid: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  res_street_address: string | null;
  res_city: string | null;
  res_zip: string | null;
  party_cd: string | null;
  age: number | null;
  birth_year: number | null;
  phone: string | null;
  email: string | null;
  precinct_desc: string | null;
  municipality_desc: string | null;
};

// Sanitize the JSON filter into a shape build_cohort() understands.
// Empty strings become nulls; numbers stay numbers.
function toRpcFilter(f: CohortFilter, listId?: string | null): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  if (f.age_min != null) r.age_min = f.age_min;
  if (f.age_max != null) r.age_max = f.age_max;
  if (f.party) r.party = f.party;
  if (f.city) r.city = f.city;
  if (f.zip) r.zip = f.zip;
  if (f.precinct) r.precinct = f.precinct;
  if (f.municipality) r.municipality = f.municipality;
  if (f.state) r.state = f.state;
  if (f.voter_status) r.voter_status = f.voter_status;
  if (f.voted_in) r.voted_in = f.voted_in;
  if (f.voted_party) r.voted_party = f.voted_party;
  if (f.voted_after) r.voted_after = f.voted_after;
  if (f.voted_before) r.voted_before = f.voted_before;
  if (f.min_total_votes != null) r.min_total_votes = f.min_total_votes;
  if (f.min_relevant_votes != null) r.min_relevant_votes = f.min_relevant_votes;
  if (listId) r.list_id = listId;
  r.only_my_lists = true;
  return r;
}

export async function buildCohort(
  supabase: SupabaseClient,
  filter: CohortFilter,
  opts: { listId?: string | null; limit?: number } = {},
): Promise<CohortRow[]> {
  const rpc = toRpcFilter(filter, opts.listId);
  const { data, error } = await supabase.rpc("build_cohort", {
    p_filter: rpc,
    p_limit: Math.min(opts.limit ?? 5000, 5000),
  });
  if (error) {
    log.warn("cohort.build_failed", { err: error.message, filter: rpc });
    throw new ExternalServiceError(error.message, "supabase", error);
  }
  return (data as CohortRow[] | null) ?? [];
}
