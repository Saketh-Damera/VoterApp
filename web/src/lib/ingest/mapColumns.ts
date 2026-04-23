import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Canonical target schema; values in the mapping are source column names from the uploaded file.
export const ColumnMap = z.object({
  ncid:               z.string().nullable().describe("Source column containing a unique voter ID for this state/jurisdiction. Null if none."),
  first_name:         z.string().nullable(),
  middle_name:        z.string().nullable(),
  last_name:          z.string().nullable(),
  name_suffix:        z.string().nullable().describe("Jr / Sr / III suffix column, if present."),
  res_street_address: z.string().nullable().describe("Residence street address; may need combining street number + street name columns (choose the most complete single column)."),
  res_city:           z.string().nullable(),
  res_zip:            z.string().nullable(),
  party_cd:           z.string().nullable(),
  gender_code:        z.string().nullable(),
  race_code:          z.string().nullable(),
  birth_year:         z.string().nullable(),
  age:                z.string().nullable(),
  registr_dt:         z.string().nullable().describe("Registration date column."),
  precinct_desc:      z.string().nullable(),
  ward_desc:          z.string().nullable(),
  municipality_desc:  z.string().nullable(),
  // helper column the mapper can flag if the file has multiple street-number / street-name columns
  street_number:      z.string().nullable().describe("Standalone house-number column, when address is split across two columns."),
  street_name:        z.string().nullable().describe("Standalone street-name column, when address is split across two columns."),
});

export type ColumnMap = z.infer<typeof ColumnMap>;

const SYSTEM_PROMPT = `You are a data integration assistant mapping columns in a voter-file upload to a canonical schema.

You will see:
- A list of source column headers from the uploaded file
- A few sample data rows

Return a JSON object whose keys are the canonical fields. For each canonical field, put the NAME of the source column that best matches, or null if no source column fits.

Rules:
- Use the exact source column name as the value — never invent one.
- Many files split address across two columns (house number + street name). When that's the case, populate street_number and street_name AND set res_street_address to whichever single column has the most complete address, OR to street_name if only split columns exist.
- If a column is a voter registration/election ID, map it to ncid.
- birth_year should be a 4-digit year column. If only age_at_year_end is available, use age.
- Leave any field null if there's genuinely no match — don't force a mapping.`;

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
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent }],
    output_config: { format: zodOutputFormat(ColumnMap) },
  });
  if (!response.parsed_output) throw new Error("Claude returned no parsed output");
  return response.parsed_output;
}
