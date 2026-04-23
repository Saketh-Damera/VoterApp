import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const DebriefExtract = z.object({
  captured_name: z.string().describe("The person's name as spoken (first + last if given). Use empty string if no name mentioned."),
  captured_location: z.string().nullable().describe("Where the conversation happened, if mentioned ('at the farmers market', 'at PTA')."),
  cleaned_notes: z.string().describe("The full substance of what was said, cleaned up to read as a short note. Keep all factual detail. Remove filler words."),
  issues: z.array(z.string()).describe("Short lowercase topics raised ('oak-traffic', 'education', 'zoning')."),
  sentiment: z.enum(["supportive", "leaning_supportive", "undecided", "leaning_opposed", "opposed", "unknown"]),
  tags: z.array(z.string()).describe("Short lowercase tags about the person (role, affiliation, network)."),
  follow_up: z
    .object({
      days_until: z.number().int(),
      action: z.string(),
    })
    .nullable(),
  wants_sign: z.boolean().describe("Did they say they want a yard sign?"),
  wants_to_volunteer: z.boolean().describe("Did they offer to volunteer, host, or help?"),
});
export type DebriefExtract = z.infer<typeof DebriefExtract>;

const SYSTEM = `You are parsing a candidate's voice-dictated debrief after a voter conversation into structured data.

Extract: the person's name, where they talked, the substance of the conversation, issues raised, sentiment, person tags, a follow-up plan, and whether they asked for a yard sign or offered to help.

Rules:
- Be faithful to what was actually said. Don't invent.
- Pick a single short sentiment value; default to unknown if unclear.
- Issue and tag tokens are lowercase and hyphenated ('oak-traffic', 'public-schools').
- Follow-up should be null if nothing needs one; otherwise a specific action + 1-30 days.`;

export async function extractDebrief(transcript: string): Promise<DebriefExtract> {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: process.env.JED_MODEL ?? "claude-haiku-4-5",
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: transcript }],
    output_config: { format: zodOutputFormat(DebriefExtract) },
  });
  if (!response.parsed_output) throw new Error("Claude returned no debrief extract");
  return response.parsed_output;
}
