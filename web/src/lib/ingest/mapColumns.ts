import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Canonical voter columns. Empty string = no source column matched.
// Anything in the source file that doesn't fit one of these still gets
// preserved on voters.extra (jsonb) by the upload route, so nothing is lost.
export const ColumnMap = z.object({
  // Identity
  ncid:               z.string().describe("Source column with a unique voter/registration ID. Empty if none."),
  full_name:          z.string().describe("Single column with the entire name (e.g. 'John Q Smith Jr' or 'Smith, John Q')."),
  first_name:         z.string(),
  middle_name:        z.string(),
  last_name:          z.string(),
  name_suffix:        z.string().describe("Jr / Sr / III / IV suffix column."),

  // Residential address
  res_street_address: z.string().describe("Single column with the full residence address."),
  street_number:      z.string().describe("House-number column when address is split."),
  street_name:        z.string().describe("Street-name column when address is split."),
  street_unit:        z.string().describe("Apartment / unit / suite — gets appended to the address."),
  res_city:           z.string(),
  res_zip:            z.string(),

  // Mailing address (when different from residential)
  mailing_address:    z.string().describe("Mailing street address column — only when distinct from residential."),
  mailing_city:       z.string(),
  mailing_state:      z.string(),
  mailing_zip:        z.string(),

  // Contact
  phone:              z.string().describe("Primary phone number."),
  phone_secondary:    z.string().describe("Secondary phone if a second column exists."),
  email:              z.string().describe("Primary email address."),
  email_secondary:    z.string(),
  website:            z.string().describe("Personal website / social handle URL."),

  // Demographics
  party_cd:           z.string(),
  gender_code:        z.string(),
  race_code:          z.string(),
  birth_year:         z.string().describe("4-digit year of birth column."),
  age:                z.string().describe("Numeric age column when no birth year."),
  registr_dt:         z.string().describe("Voter registration date column."),
  language_preference: z.string().describe("Preferred language (e.g. EN, ES)."),

  // Employment / civic
  occupation:         z.string(),
  employer:           z.string(),
  household_id:       z.string().describe("Household identifier when the file groups people by household."),
  voter_status:       z.string().describe("Active / Inactive / Suspended column."),
  voter_status_reason: z.string(),

  // Geographic
  precinct_desc:      z.string(),
  ward_desc:          z.string(),
  municipality_desc:  z.string(),
  congressional_district: z.string(),
  state_house_district: z.string(),
  state_senate_district: z.string(),
  school_district:    z.string(),

  // Provenance
  last_updated_in_source: z.string().describe("When the source system last updated this record."),
});

export type ColumnMap = z.infer<typeof ColumnMap>;

const SYSTEM = `You map columns in an arbitrary voter / contact / donor file to a canonical schema.

You will see:
- Source column headers from the uploaded file
- Up to 5 sample data rows

Return a JSON object whose keys are the canonical fields. For each canonical field, set the value to the NAME of the source column that best matches. If no source column fits, set it to "" (empty string).

Rules:
- Use the EXACT source column header as the value — never invent. Empty string means no match.
- Names: if there's ONE column for the whole name, map to full_name only and leave first/middle/last empty. If split, map first/middle/last and leave full_name empty. Don't map both styles.
- Residential vs mailing address: use the residential (home) address for res_*. If the file ALSO has a separate mailing address (different from residential), map mailing_*. Don't double-map the same column.
- Addresses can be split into number + name + unit. Map all three when present.
- Contact: phone / phone_secondary; email / email_secondary. If only one phone or email, map only the primary.
- IDs: any column uniquely identifying the registration record (NCID, voter ID, registration #, SOS_VOTERID, statewide ID) → ncid.
- birth_year MUST be a 4-digit year column. Don't put age values in birth_year.
- Anything you don't recognize, leave as empty string. The upload pipeline preserves all unmapped columns separately so nothing is lost.

Examples:

Input columns: ["Last, First", "DOB", "Address", "City", "Phone", "Email"]
Sample row: {"Last, First": "Smith, John Q", "DOB": "1965-04-12", "Address": "123 Main St Apt 4", "City": "Tenafly", "Phone": "201-555-1234", "Email": "john@example.com"}
Output: full_name="Last, First", res_street_address="Address", res_city="City", phone="Phone", email="Email", birth_year="" (DOB is a date, age can be derived elsewhere), everything else "".

Input columns: ["Voter ID", "FNAME", "LNAME", "HOUSE_NUM", "STREET", "UNIT", "ZIP", "PRIMARY_PHONE", "SECONDARY_PHONE", "EMAIL_ADDR", "OCCUPATION", "EMPLOYER", "HOUSEHOLD"]
Output: ncid="Voter ID", first_name="FNAME", last_name="LNAME", street_number="HOUSE_NUM", street_name="STREET", street_unit="UNIT", res_zip="ZIP", phone="PRIMARY_PHONE", phone_secondary="SECONDARY_PHONE", email="EMAIL_ADDR", occupation="OCCUPATION", employer="EMPLOYER", household_id="HOUSEHOLD".`;

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
    max_tokens: 1500,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent }],
    output_config: { format: zodOutputFormat(ColumnMap) },
  });
  if (!response.parsed_output) throw new Error("Claude returned no parsed output");
  return response.parsed_output;
}
