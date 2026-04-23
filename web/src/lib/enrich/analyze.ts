import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const NoteAnalysis = z.object({
  issues: z
    .array(z.string())
    .describe(
      "Policy or topic concerns the voter raised (e.g. 'education', 'rezoning', 'property taxes'). Lowercase, short phrases.",
    ),
  sentiment: z
    .enum(["supportive", "leaning_supportive", "undecided", "leaning_opposed", "opposed", "unknown"])
    .describe("The voter's stance toward the candidate inferred from the notes."),
  tags: z
    .array(z.string())
    .describe(
      "Short descriptive tags about the person — role, affiliation, or network (e.g. 'parent', 'teacher', 'small-business-owner', 'spanish-speaking'). Lowercase, hyphenated.",
    ),
  follow_up: z
    .object({
      days_until: z
        .number()
        .int()
        .min(1)
        .max(30)
        .describe("How many days from now the candidate should follow up."),
      action: z
        .string()
        .describe(
          "Specific action for the follow-up (e.g. 'text with rezoning update', 'ask if spouse will vote').",
        ),
    })
    .nullable()
    .describe(
      "Suggested follow-up, or null if no follow-up is warranted from the notes alone.",
    ),
});

export type NoteAnalysis = z.infer<typeof NoteAnalysis>;

const SYSTEM_PROMPT = `You are an assistant helping a first-time local candidate turn free-text notes from voter interactions into structured intelligence.

Given the candidate's raw notes about one interaction, extract:
- issues: policy or topic concerns the voter raised
- sentiment: their stance toward the candidate
- tags: role/affiliation/network attributes about the person
- follow_up: a single concrete next step if warranted by the notes

Rules:
- Infer only what is clearly supported by the notes. Do not speculate.
- If the notes mention a spouse, teacher network, PTA, business, union, or other group — tag it.
- If the voter raised a concern or asked a question, suggest a follow-up that addresses it.
- If the notes are too sparse to act on, return follow_up: null.
- Keep issues and tags short and lowercase. Prefer existing canonical forms (education, not "educational concerns").`;

export async function analyzeNotes(notes: string): Promise<NoteAnalysis> {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: process.env.JED_MODEL_CHEAP ?? process.env.JED_MODEL ?? "claude-haiku-4-5",
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: notes }],
    output_config: { format: zodOutputFormat(NoteAnalysis) },
  });
  if (!response.parsed_output) {
    throw new Error("Claude returned no parsed output");
  }
  return response.parsed_output;
}
