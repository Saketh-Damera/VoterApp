import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Canonical target schema; values in the mapping are source column names from
// the uploaded file. Empty string = no match (Anthropic's structured-output
// API caps at 16 union/nullable fields per schema; we have 19, so we use
// empty-string sentinel instead of nullable strings).
export const ColumnMap = z.object({
  ncid:               z.string().describe("Source column containing a unique voter ID for this state/jurisdiction. Empty string if none."),
  first_name:         z.string(),
  middle_name:        z.string(),
  last_name:          z.string(),
  name_suffix:        z.string().describe("Jr / Sr / III suffix column, if present."),
  res_street_address: z.string().describe("Residence street address; may need combining street number + street name columns (choose the most complete single column)."),
  res_city:           z.string(),
  res_zip:            z.string(),
  party_cd:           z.string(),
  gender_code:        z.string(),
  race_code:          z.string(),
  birth_year:         z.string(),
  age:                z.string(),
  registr_dt:         z.string().describe("Registration date column."),
  precinct_desc:      z.string(),
  ward_desc:          z.string(),
  municipality_desc:  z.string(),
  street_number:      z.string().describe("Standalone house-number column, when address is split across two columns."),
  street_name:        z.string().describe("Standalone street-name column, when address is split across two columns."),
});

export type ColumnMap = z.infer<typeof ColumnMap>;

const SYSTEM = `You are a data integration assistant mapping columns in a voter-file upload to a canonical schema.

You will see:
- A list of source column headers from the uploaded file
- A few sample data rows

Return a JSON object whose keys are the canonical fields. For each canonical field, put the NAME of the source column that best matches. If no source column matches a canonical field, return an empty string "" for that field.

Rules:
- Use the exact source column name as the value — never invent one. Empty string "" means no match.
- Many files split address across two columns (house number + street name). When that's the case, populate street_number and street_name AND set res_street_address to whichever single column has the most complete address, OR to street_name if only split columns exist.
- If a column is a voter registration/election ID, map it to ncid.
- birth_year should be a 4-digit year column. If only age_at_year_end is available, use age.
- Don't force matches — leave the field as "" if nothing fits.`;

export async function mapColumns(
  headers: string[],
  sampleRows: Record<string, string>[],
): Promise<ColumnMap> {
  const client = new Anthropic();
  const userContent =
    `Source columns:\n${headers.map((h) => `  - ${h}`).join("\n")}\n\n` +
    `Sample rows (JSON):\n${JSON.stringify(sampleRows.slice(0, 5), null, 2)}`;

  const response = await client.messages.parse({
    model: process.env.JED_MODEL_CHEAP ?? process.env.JED_MODEL ?? "claude-haiku-4-5",
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent }],
    output_config: { format: zodOutputFormat(ColumnMap) },
  });
  if (!response.parsed_output) throw new Error("Claude returned no parsed output");
  return response.parsed_output;
}
