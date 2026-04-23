import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Canonical donor-prospect schema; values are source column names from the file.
export const DonorColumnMap = z.object({
  full_name:          z.string().nullable().describe("Column with the donor's name (may need to combine first + last if only split columns exist)."),
  first_name:         z.string().nullable(),
  last_name:          z.string().nullable(),
  email:              z.string().nullable(),
  phone:              z.string().nullable(),
  employer:           z.string().nullable().describe("Company or employer column."),
  role:               z.string().nullable().describe("Job title, occupation, or role column."),
  estimated_capacity: z.string().nullable().describe("Column indicating giving capacity or past contribution amount (dollars)."),
  notes:              z.string().nullable().describe("Free-text notes / context column, if any."),
});
export type DonorColumnMap = z.infer<typeof DonorColumnMap>;

const SYSTEM = `You are mapping columns from a donor/prospect spreadsheet to a canonical schema.

Given the list of source column headers plus a few sample rows, return a JSON object whose keys are the canonical donor fields. Each value is the EXACT source column name that best matches, or null if nothing fits.

Rules:
- Never invent a source column name.
- If the file has a single "Name" or "Donor" column, put it in full_name and leave first_name / last_name null. If split, put first_name + last_name, and leave full_name null (we'll combine at insert time).
- estimated_capacity is usually a dollar amount (max gift, average gift, wealth score, etc.). Use your judgment — any single numeric column that signals giving capacity.
- Leave fields null if genuinely no match.`;

export async function mapDonorColumns(
  headers: string[],
  sampleRows: Record<string, string>[],
): Promise<DonorColumnMap> {
  const client = new Anthropic();
  const content =
    `Source columns:\n${headers.map((h) => `  - ${h}`).join("\n")}\n\n` +
    `Sample rows (JSON):\n${JSON.stringify(sampleRows.slice(0, 5), null, 2)}`;

  const response = await client.messages.parse({
    model: process.env.JED_MODEL_CHEAP ?? process.env.JED_MODEL ?? "claude-haiku-4-5",
    max_tokens: 512,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(DonorColumnMap) },
  });
  if (!response.parsed_output) throw new Error("Claude returned no donor column map");
  return response.parsed_output;
}
