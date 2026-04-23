import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// ---------- Pre-conversation brief ----------

export const VoterBrief = z.object({
  headline: z.string().describe("One-sentence headline summarizing who this voter is in context of the campaign."),
  key_facts: z.array(z.string()).describe("3-5 short factual bullet points about the voter (age, party, past voting, etc.)."),
  issues_they_care_about: z.array(z.string()).describe("Issues they've raised or likely care about, inferred from notes + tags."),
  talking_points: z.array(z.string()).describe("3 concrete, specific talking points calibrated to this person — not generic."),
  suggested_ask: z.string().describe("One specific, relational-organizing ask tailored to this person's profile (e.g. 'refer 3 teachers for a house party', 'sign rezoning petition', 'host a porch meeting')."),
});
export type VoterBrief = z.infer<typeof VoterBrief>;

type BriefInput = {
  candidate: { name: string; office: string | null; jurisdiction: string | null };
  voter: {
    first_name: string | null;
    last_name: string | null;
    age: number | null;
    party_cd: string | null;
    res_street_address: string | null;
    res_city: string | null;
    precinct_desc: string | null;
  };
  turnout: { elections_voted: number; generals_voted: number; last_voted: string | null } | null;
  interactions: Array<{
    created_at: string;
    captured_location: string | null;
    notes: string | null;
    sentiment: string | null;
    issues: string[] | null;
    tags: string[] | null;
  }>;
  household: Array<{ first_name: string | null; last_name: string | null; age: number | null; party_cd: string | null }>;
};

const BRIEF_SYSTEM = `You are a relational-organizing coach briefing a first-time local candidate before they talk with a specific voter.

Given a voter's profile, household, turnout history, and prior interactions with the candidate, produce a short, actionable brief:
- A one-line headline placing the person in context.
- 3-5 key facts (age, party, turnout, household signals).
- Issues the voter cares about (from tags / issues / notes).
- 3 talking points calibrated to THIS person — not generic campaign talking points.
- One specific relational-organizing ask: something this person is well-positioned to do (e.g. "refer 3 teachers for a house party", "host a porch meeting", "ask spouse to register").

Be concrete. Prefer short sentences. Do not invent facts — if something isn't in the data, don't mention it.`;

export async function generateBrief(input: BriefInput): Promise<VoterBrief> {
  const client = new Anthropic();
  const content =
    `Candidate: ${input.candidate.name}` +
    (input.candidate.office ? ` (${input.candidate.office})` : "") +
    (input.candidate.jurisdiction ? ` · ${input.candidate.jurisdiction}` : "") +
    `\n\nVoter: ${JSON.stringify(input.voter)}` +
    `\nTurnout: ${JSON.stringify(input.turnout)}` +
    `\nHousehold members: ${JSON.stringify(input.household)}` +
    `\nInteractions (most recent first): ${JSON.stringify(input.interactions.slice(0, 5))}`;

  const response = await client.messages.parse({
    model: process.env.JED_MODEL ?? "claude-haiku-4-5",
    max_tokens: 1024,
    system: [{ type: "text", text: BRIEF_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(VoterBrief) },
  });
  if (!response.parsed_output) throw new Error("Claude returned no parsed brief");
  return response.parsed_output;
}

// ---------- Personalized follow-up message ----------

export const DraftMessage = z.object({
  channel: z.enum(["sms", "email", "handwritten"]).describe("Recommended channel based on how personal the relationship is."),
  subject: z.string().nullable().describe("Subject line if channel is email; null otherwise."),
  body: z.string().describe("The drafted message body — warm, specific, under 100 words for SMS and under 200 for email."),
  rationale: z.string().describe("One-line explanation of why this approach fits this person."),
});
export type DraftMessage = z.infer<typeof DraftMessage>;

const DRAFT_SYSTEM = `You are drafting a personalized follow-up message for a first-time local candidate to send to a specific voter.

Given the voter's profile + prior interaction notes, write a warm, specific follow-up. The candidate is going to send it themselves, so the voice should be the candidate's — not a campaign committee.

Rules:
- Reference something specific from the interaction (issue they raised, mutual context).
- Do NOT sound like a mass-produced campaign message.
- Pick the channel that fits:
  - sms if the interaction was casual and recent
  - email if it's professional or if the voter raised a policy issue requiring detail
  - handwritten if the interaction was deep, personal, or the voter is high-value (e.g. potential donor, endorser)
- Keep it short and direct.
- End with a specific ask or next step when appropriate.`;

export async function draftFollowUp(input: BriefInput): Promise<DraftMessage> {
  const client = new Anthropic();
  const content =
    `Candidate: ${input.candidate.name}` +
    (input.candidate.office ? ` running for ${input.candidate.office}` : "") +
    `\n\nVoter: ${JSON.stringify(input.voter)}` +
    `\nRecent interactions (most recent first): ${JSON.stringify(input.interactions.slice(0, 3))}`;

  const response = await client.messages.parse({
    model: process.env.JED_MODEL ?? "claude-haiku-4-5",
    max_tokens: 1024,
    system: [{ type: "text", text: DRAFT_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(DraftMessage) },
  });
  if (!response.parsed_output) throw new Error("Claude returned no draft message");
  return response.parsed_output;
}

// ---------- Fundraising ask draft ----------

export const AskDraft = z.object({
  channel: z.enum(["email", "phone_script", "text"]).describe("Best channel based on context."),
  subject: z.string().nullable().describe("Subject line for email; null for phone/text."),
  body: z.string().describe("The drafted ask."),
  suggested_amount: z.number().describe("Suggested ask amount in dollars, based on estimated capacity and context."),
  rationale: z.string().describe("One-line explanation of amount + approach."),
});
export type AskDraft = z.infer<typeof AskDraft>;

type AskInput = {
  candidate: { name: string; office: string | null; jurisdiction: string | null };
  prospect: {
    full_name: string;
    employer: string | null;
    role: string | null;
    estimated_capacity: number | null;
    notes: string | null;
    status: string;
  };
};

const ASK_SYSTEM = `You are coaching a first-time local candidate writing a fundraising ask to a specific donor prospect.

Given the prospect's profile, draft an ask message. Rules:
- The candidate will send this themselves.
- Use the estimated_capacity to calibrate the suggested_amount — but if capacity is unclear, default to $250 for general donors, $500+ for professionals with a role suggesting means.
- Reference something specific about the prospect when notes allow.
- Email format for professional contacts, phone script for close relationships, text for warm casual contacts.
- Keep it short. Ask clearly. Include a specific next-step (call, reply, donate link).`;

export async function draftAsk(input: AskInput): Promise<AskDraft> {
  const client = new Anthropic();
  const content =
    `Candidate: ${input.candidate.name}` +
    (input.candidate.office ? ` running for ${input.candidate.office}` : "") +
    (input.candidate.jurisdiction ? ` · ${input.candidate.jurisdiction}` : "") +
    `\n\nProspect: ${JSON.stringify(input.prospect)}`;

  const response = await client.messages.parse({
    model: process.env.JED_MODEL ?? "claude-haiku-4-5",
    max_tokens: 1024,
    system: [{ type: "text", text: ASK_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(AskDraft) },
  });
  if (!response.parsed_output) throw new Error("Claude returned no ask draft");
  return response.parsed_output;
}
