// Debrief extractor. Sends a transcript to Claude with a structured-output
// schema and returns the parsed extract. Wraps every call with retry +
// logging via the shared anthropic client.

import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ai } from "./anthropic";
import { ExternalServiceError } from "@/domain/errors";

const Sentiment = z.enum([
  "supportive",
  "leaning_supportive",
  "undecided",
  "leaning_opposed",
  "opposed",
  "unknown",
]);

export const Participant = z.object({
  name: z.string(),
  relationship: z.string(),
  sentiment: Sentiment,
  issues: z.array(z.string()),
  tags: z.array(z.string()),
  notes: z.string(),
});
export type Participant = z.infer<typeof Participant>;

export const DebriefExtract = z.object({
  participants: z.array(Participant),
  captured_location: z.string().nullable(),
  cleaned_notes: z.string(),
  follow_up: z.object({ days_until: z.number().int(), action: z.string() }).nullable(),
  wants_sign: z.boolean(),
  wants_to_volunteer: z.boolean(),
  mentioned_people: z.array(
    z.object({
      name: z.string(),
      relationship: z.string(),
      context: z.string(),
      should_contact: z.boolean(),
    }),
  ),
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

const MAX_TRANSCRIPT_CHARS = 50_000;

export async function extractDebrief(transcript: string): Promise<DebriefExtract> {
  const trimmed = transcript.length > MAX_TRANSCRIPT_CHARS
    ? transcript.slice(0, MAX_TRANSCRIPT_CHARS) + "\n[transcript truncated]"
    : transcript;

  const response = await ai.parse("extractDebrief", {
    model: process.env.JED_MODEL ?? "claude-haiku-4-5",
    max_tokens: 2048,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: trimmed }],
    output_config: { format: zodOutputFormat(DebriefExtract) },
  });

  if (!response.parsed_output) {
    throw new ExternalServiceError("Claude returned no debrief extract", "anthropic");
  }
  // Defensive: model can elide participants when transcript is degenerate.
  if (!response.parsed_output.participants?.length) {
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
