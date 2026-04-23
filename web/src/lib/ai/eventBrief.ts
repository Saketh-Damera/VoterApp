import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const EventBrief = z.object({
  headline: z.string().describe("One sentence characterizing this event and the room."),
  room_composition: z.array(z.string()).describe("2-4 bullets describing the attendees collectively (demographics, networks, turnout profile)."),
  lead_with: z.array(z.string()).describe("2-3 topics/messages to lead with, given the overlap of concerns."),
  avoid: z.array(z.string()).describe("1-2 topics or tones to avoid, given the room — or an empty array if nothing comes to mind."),
  specific_asks: z.array(z.object({
    attendee_name: z.string(),
    ask: z.string(),
  })).describe("For up to 5 individual attendees, a specific relational-organizing ask tailored to them."),
  open_with_line: z.string().describe("A concrete opening line the candidate could use to kick off the event."),
});
export type EventBrief = z.infer<typeof EventBrief>;

type AttendeeCtx = {
  name: string;
  city: string | null;
  party: string | null;
  last_sentiment: string | null;
  issues: string[];
  tags: string[];
  recent_note: string | null;
};

type Input = {
  candidate: { name: string; office: string | null; jurisdiction: string | null };
  event: { title: string; location: string | null; event_date: string | null; notes: string | null };
  attendees: AttendeeCtx[];
};

const SYSTEM = `You are coaching a first-time local candidate before an event (house party, coffee, town hall).

You will see:
- The event's title, location, date, and the candidate's own notes
- Each expected attendee, with their issue concerns, tags, latest sentiment, and most recent interaction note

Produce a one-page brief:
- headline: one sentence characterizing the room
- room_composition: collective demographics/networks/turnout profile
- lead_with: 2-3 topics to emphasize given the overlap
- avoid: topics or tones to pull back on for this specific room
- specific_asks: for up to 5 named attendees, a relational-organizing ask calibrated to them
- open_with_line: a concrete opening line

Rules:
- Ground everything in the actual attendee data — don't invent.
- Prefer short, punchy language.
- The candidate is going to read this on their phone 5 minutes before walking in.`;

export async function generateEventBrief(input: Input): Promise<EventBrief> {
  const client = new Anthropic();
  const content =
    `Candidate: ${input.candidate.name}` +
    (input.candidate.office ? ` (${input.candidate.office})` : "") +
    (input.candidate.jurisdiction ? ` · ${input.candidate.jurisdiction}` : "") +
    `\n\nEvent: ${JSON.stringify(input.event)}` +
    `\n\nAttendees (${input.attendees.length}):\n` +
    input.attendees.map((a) => JSON.stringify(a)).join("\n");

  const response = await client.messages.parse({
    model: process.env.JED_MODEL ?? "claude-haiku-4-5",
    max_tokens: 1500,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(EventBrief) },
  });
  if (!response.parsed_output) throw new Error("Claude returned no event brief");
  return response.parsed_output;
}
