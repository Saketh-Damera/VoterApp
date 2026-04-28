import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

const Sentiment = z.enum([
  "supportive",
  "leaning_supportive",
  "undecided",
  "leaning_opposed",
  "opposed",
  "unknown",
]);

// One participant in a conversation. The candidate may have spoken with
// multiple people in the same encounter — a couple at their door, a family
// at PTA, two coworkers at a coffee shop.
export const Participant = z.object({
  name: z.string().describe("The person's name as spoken (first + last if given)."),
  relationship: z.string().describe("Relationship to the lead participant ('spouse', 'son', 'roommate'). Empty string if none/unknown."),
  sentiment: Sentiment.describe("This specific person's sentiment toward the candidate."),
  issues: z.array(z.string()).describe("Issues this person specifically raised ('oak-traffic', 'public-schools'). Empty if none."),
  tags: z.array(z.string()).describe("Short lowercase tags about this person (role, affiliation). Empty if none."),
  notes: z.string().describe("What this specific person said or wanted, in 1-3 short sentences. Empty if nothing person-specific."),
});
export type Participant = z.infer<typeof Participant>;

export const DebriefExtract = z.object({
  participants: z.array(Participant)
    .describe("Every person the candidate actually talked TO in this conversation. Almost always at least one. The first entry is the lead/primary participant."),
  captured_location: z.string().nullable().describe("Where the conversation happened, if mentioned ('at the farmers market', 'at PTA')."),
  cleaned_notes: z.string().describe("The full encounter, cleaned up to read as a short note. Keep all factual detail. Remove filler words. This is the conversation-level summary; per-person specifics belong in each participant's notes."),
  follow_up: z
    .object({
      days_until: z.number().int(),
      action: z.string(),
    })
    .nullable(),
  wants_sign: z.boolean().describe("Did anyone in the conversation say they want a yard sign?"),
  wants_to_volunteer: z.boolean().describe("Did anyone offer to volunteer, host, or help?"),
  mentioned_people: z
    .array(
      z.object({
        name: z.string().describe("Person's name as stated."),
        relationship: z.string().describe("Relationship to a participant ('spouse', 'neighbor', 'coworker at X', etc.)."),
        context: z.string().describe("What was said about them."),
        should_contact: z.boolean().describe("Did anyone suggest the candidate reach out to this person?"),
      }),
    )
    .describe("People REFERENCED in the conversation but NOT present. Empty array if none. Do not duplicate participants here."),
});
export type DebriefExtract = z.infer<typeof DebriefExtract>;

const SYSTEM = `You are parsing a candidate's debrief after a voter conversation into structured data.

A single conversation can involve more than one person. If the candidate says they talked with "Pinaki and Anjali Dasgupta" or "the Smith family" or "John and his wife", emit one entry in participants[] for each person actually present in the conversation. The first entry is the lead/primary participant. If only one person was there, participants[] has one entry.

Per-person fields:
- Each participant gets their OWN sentiment, issues, tags, and notes — Pinaki may be supportive while Anjali is undecided.
- relationship describes the link to the lead participant ("spouse", "son", "roommate"). Empty string for the lead or when unknown.
- If the candidate did not name a specific person ("a guy on the porch"), use the descriptive phrase as the name and leave relationship blank.

mentioned_people stays for people REFERENCED in the conversation but who were not part of the conversation themselves (a spouse who was at work, a neighbor the voter wants you to call). Never duplicate someone between participants[] and mentioned_people.

Conversation-level fields (captured_location, cleaned_notes, follow_up, wants_sign, wants_to_volunteer) describe the encounter as a whole.

Rules:
- Be faithful to what was actually said. Don't invent.
- Sentiment defaults to unknown if unclear for a given person.
- Issue and tag tokens are lowercase and hyphenated ('oak-traffic', 'public-schools').
- Follow-up should be null if nothing needs one; otherwise a specific action + 1-30 days.`;

// Cap to ~50K chars so a long Whisper transcript can't blow up cost or
// latency. Approx 12K tokens of input — well within Haiku's window.
const MAX_TRANSCRIPT_CHARS = 50_000;

export async function extractDebrief(transcript: string): Promise<DebriefExtract> {
  const trimmed = transcript.length > MAX_TRANSCRIPT_CHARS
    ? transcript.slice(0, MAX_TRANSCRIPT_CHARS) + "\n[transcript truncated]"
    : transcript;
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: process.env.JED_MODEL ?? "claude-haiku-4-5",
    max_tokens: 2048,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: trimmed }],
    output_config: { format: zodOutputFormat(DebriefExtract) },
  });
  if (!response.parsed_output) throw new Error("Claude returned no debrief extract");
  if (!response.parsed_output.participants?.length) {
    // Fallback so downstream code always has at least one participant entry.
    response.parsed_output.participants = [{
      name: "(from debrief)",
      relationship: "",
      sentiment: "unknown",
      issues: [],
      tags: [],
      notes: "",
    }];
  }
  return response.parsed_output;
}
