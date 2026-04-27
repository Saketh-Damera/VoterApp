import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Canonical target schema; values in the mapping are source column names from
// the uploaded file. Empty string = no match (Anthropic's structured-output
// API caps at 16 union/nullable fields per schema, so we use empty-string
// sentinel rather than nullable strings).
export const ColumnMap = z.object({
  ncid:               z.string().describe("Source column with a unique voter/registration ID. Empty string if none."),
  full_name:          z.string().describe("Single column containing the entire name (e.g. 'John Q Smith Jr' or 'Smith, John Q'). Empty if name is split across columns."),
  first_name:         z.string(),
  middle_name:        z.string(),
  last_name:          z.string(),
  name_suffix:        z.string().describe("Jr/Sr/III/IV suffix column."),
  res_street_address: z.string().describe("Single column with the full residence address."),
  street_number:      z.string().describe("House-number column when address is split."),
  street_name:        z.string().describe("Street-name column when address is split."),
  street_unit:        z.string().describe("Apartment/unit/suite column, e.g. 'Apt 4B'. Will be appended to the address."),
  res_city:           z.string(),
  res_zip:            z.string(),
  party_cd:           z.string(),
  gender_code:        z.string(),
  race_code:          z.string(),
  birth_year:         z.string(),
  age:                z.string(),
  registr_dt:         z.string().describe("Voter registration date column."),
  precinct_desc:      z.string(),
  ward_desc:          z.string(),
  municipality_desc:  z.string(),
});

export type ColumnMap = z.infer<typeof ColumnMap>;

const SYSTEM = `You map columns in an arbitrary voter/contact file to a canonical schema. The file might be a state voter file, a campaign-provided list, a donor export, a precinct walk list, or anything else with names and addresses.

You will see:
- Source column headers from the uploaded file
- Up to 5 sample data rows

Return a JSON object whose keys are the canonical fields. For each canonical field, set the value to the NAME of the source column that best matches. If no source column fits a canonical field, set it to "" (empty string).

Rules:
- Use the EXACT source column header as the value — never invent or rephrase one. Empty string "" means no match.
- Names: if the file has ONE column for the whole name (e.g. "Voter Name", "Full Name", or values like "Smith, John" or "John Smith"), map it to full_name and leave first_name/middle_name/last_name empty. If the name is already split into separate columns, map first_name/middle_name/last_name and leave full_name empty. Don't map both styles at once.
- Addresses: many files split into house-number + street-name (sometimes with a unit/apartment column). When that's the case, populate street_number + street_name and leave res_street_address empty. Always map street_unit if there's a separate apt/unit/suite column. If there's a single complete address column, map res_street_address only.
- IDs: any column that uniquely identifies a registration record (NCID, voter ID, registration #, SOS_VOTERID, statewide ID) → ncid.
- birth_year must be a 4-digit year column. Don't put age values into birth_year.
- Don't force matches. Leave fields as "" rather than mapping ambiguous columns. It's fine to leave many fields empty.

Examples:

Input columns: ["Last, First", "DOB", "Address", "City"]
Sample row: {"Last, First": "Smith, John Q", "DOB": "1965-04-12", "Address": "123 Main St Apt 4", "City": "Tenafly"}
Output: full_name="Last, First", res_street_address="Address", res_city="City", everything else "".

Input columns: ["Voter ID", "FNAME", "LNAME", "HOUSE_NUM", "STREET", "UNIT", "ZIP"]
Output: ncid="Voter ID", first_name="FNAME", last_name="LNAME", street_number="HOUSE_NUM", street_name="STREET", street_unit="UNIT", res_zip="ZIP", everything else "".`;

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
