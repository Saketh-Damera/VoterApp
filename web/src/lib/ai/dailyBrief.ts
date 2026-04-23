import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const DailyBrief = z.object({
  headline: z.string().describe("One warm, opinionated sentence framing the day."),
  top_action: z.string().describe("The single most important thing the candidate should do today, named specifically (use a person's name if the data supports it)."),
  sentiment_trend: z.string().describe("One sentence on how the last week's interactions are trending (supportive moving up, more undecideds, etc.). If there's not enough data, say so."),
  issue_of_the_week: z.string().describe("The most-raised issue this week, or a note if the sample is too small."),
});
export type DailyBrief = z.infer<typeof DailyBrief>;

type Input = {
  candidate: { name: string; office: string | null; election_days: number | null };
  counts: {
    interactions_7d: number;
    interactions_total: number;
    supportive: number;
    undecided: number;
    top_priority_name: string | null;
    top_priority_reason: string | null;
  };
  recent_issues: string[];
  recent_sentiments: string[];
};

const SYSTEM = `You are giving a first-time local candidate their morning briefing. You see the last week's activity counts and their current top-priority contact.

Produce a terse, opinionated daily brief:
- headline: one warm, pointed sentence framing the day (reference the election countdown if provided)
- top_action: one concrete action, named specifically — use the person's name if given
- sentiment_trend: one sentence on whether the week's interactions are trending supportive, undecided, or mixed. If there's not enough data (fewer than 5 interactions in the week), say so plainly.
- issue_of_the_week: the most-raised issue, or say "too early to call" if the sample is thin

Rules:
- Keep each field under 25 words.
- Be honest, not cheerleading. If there's nothing to report, say that.
- No "great job!" or "keep going!" filler.`;

export async function generateDailyBrief(input: Input): Promise<DailyBrief> {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: process.env.JED_MODEL ?? "claude-haiku-4-5",
    max_tokens: 512,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: JSON.stringify(input) }],
    output_config: { format: zodOutputFormat(DailyBrief) },
  });
  if (!response.parsed_output) throw new Error("Claude returned no daily brief");
  return response.parsed_output;
}
