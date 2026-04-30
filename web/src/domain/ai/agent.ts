// Tool-using JED agent. Claude gets a small set of read-only tools and
// chains them as needed to answer the user's question. The agent loop is
// hand-written (no SDK helpers) so we have explicit control over retries,
// token caps, and tool execution.
//
// IMPORTANT — only read-only tools are exposed. Any write (add to contacts,
// edit a participant) goes through user-confirmed UI buttons, never the
// agent. This keeps us on the right side of the AUP "no personalized
// targeting" line.

import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ai } from "./anthropic";
import { searchByQuestion } from "../voterSearch";
import { ExternalServiceError } from "../errors";
import { log } from "@/lib/logger";

const MAX_AGENT_STEPS = 4;

// ---- Tool definitions ----

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_voter_file",
    description:
      "Find voters in the candidate's lists whose name fuzzy-matches the query. Use for any question that names a person or surname (e.g. 'the dasgupta family', 'find pinaki', 'are there smiths in tenafly').",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The name or partial name to search for." },
        limit: { type: "integer", description: "Max results (default 30, cap 50)." },
      },
      required: ["query"],
    },
  },
  {
    name: "recall_conversations",
    description:
      "Search the candidate's logged conversations. Filter by free-text term (matches name/notes/issues/tags), sentiment, or recency. Use for questions like 'who did I talk to about schools' or 'show me supporters from last week'.",
    input_schema: {
      type: "object",
      properties: {
        term: { type: "string", description: "Free-text term to match against name, notes, issues, or tags." },
        sentiment: {
          type: "string",
          enum: ["supportive","leaning_supportive","undecided","leaning_opposed","opposed","unknown"],
          description: "Filter to only conversations with this sentiment.",
        },
        days: { type: "integer", description: "Restrict to the last N days." },
        limit: { type: "integer", description: "Max results (default 20, cap 50)." },
      },
      required: [],
    },
  },
  {
    name: "get_voter_profile",
    description:
      "Pull the full profile of one voter: bio, turnout history, household, recent vote history. Use after search_voter_file when the user wants details on a specific person.",
    input_schema: {
      type: "object",
      properties: { ncid: { type: "string", description: "The voter's ncid from search_voter_file." } },
      required: ["ncid"],
    },
  },
];

// ---- Tool runtime ----

type ToolContext = { supabase: SupabaseClient; userId: string };

async function runTool(
  ctx: ToolContext,
  name: string,
  rawInput: unknown,
): Promise<unknown> {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  if (name === "search_voter_file") {
    const query = String(input.query ?? "").trim();
    const limit = Math.min(Number(input.limit ?? 30) || 30, 50);
    const hits = await searchByQuestion(ctx.supabase, query, limit);
    return hits.map((h) => ({
      ncid: h.ncid,
      name: [h.first_name, h.middle_name, h.last_name].filter(Boolean).join(" "),
      address: h.res_street_address,
      city: h.res_city,
      party: h.party_cd,
      birth_year: h.birth_year,
    }));
  }

  if (name === "recall_conversations") {
    const term = typeof input.term === "string" ? input.term.trim() : "";
    const sentiment = typeof input.sentiment === "string" ? input.sentiment : null;
    const days = Number(input.days ?? 0);
    const limit = Math.min(Number(input.limit ?? 20) || 20, 50);

    let q = ctx.supabase
      .from("interaction_participants")
      .select(
        "captured_name, voter_ncid, sentiment, issues, tags, notes, relationship, " +
          "interactions!inner(user_id, captured_location, notes, created_at), " +
          "voters(first_name, last_name, res_street_address, res_city, party_cd)",
      )
      .eq("interactions.user_id", ctx.userId)
      .limit(limit * 2); // overshoot so client-side term filter still has room

    if (sentiment) q = q.eq("sentiment", sentiment);
    if (days > 0 && days < 3650) {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      q = q.gt("interactions.created_at", since);
    }

    const { data, error } = await q;
    if (error) {
      log.warn("agent.recall_conversations.failed", { err: error.message });
      return [];
    }
    type Inter = { user_id: string; captured_location: string | null; notes: string | null; created_at: string };
    type Vrow = { first_name: string | null; last_name: string | null; res_street_address: string | null; res_city: string | null; party_cd: string | null };
    type Row = {
      captured_name: string;
      voter_ncid: string | null;
      sentiment: string | null;
      issues: string[] | null;
      tags: string[] | null;
      notes: string | null;
      relationship: string | null;
      interactions: Inter | Inter[] | null;
      voters: Vrow | Vrow[] | null;
    };
    const arr = (data ?? []) as unknown as Row[];
    const oneInter = (i: Inter | Inter[] | null) => Array.isArray(i) ? i[0] ?? null : i;
    const oneVoter = (v: Vrow | Vrow[] | null) => Array.isArray(v) ? v[0] ?? null : v;

    const rows = arr.map((r) => {
      const inter = oneInter(r.interactions);
      const voter = oneVoter(r.voters);
      return {
        ncid: r.voter_ncid,
        name: voter
          ? [voter.first_name, voter.last_name].filter(Boolean).join(" ")
          : r.captured_name,
        date: inter?.created_at ? inter.created_at.slice(0, 10) : null,
        where: inter?.captured_location ?? null,
        sentiment: r.sentiment,
        issues: r.issues ?? [],
        tags: r.tags ?? [],
        notes: r.notes ?? inter?.notes ?? null,
        address: voter?.res_street_address ?? null,
        city: voter?.res_city ?? null,
      };
    });
    if (term) {
      const t = term.toLowerCase();
      return rows
        .filter((r) => {
          const hay = [
            r.name, r.where, r.notes, r.address, r.city,
            ...(r.issues ?? []), ...(r.tags ?? []),
          ].filter(Boolean).join(" ").toLowerCase();
          return hay.includes(t);
        })
        .slice(0, limit);
    }
    return rows
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, limit);
  }

  if (name === "get_voter_profile") {
    const ncid = typeof input.ncid === "string" ? input.ncid : "";
    if (!ncid) return { error: "ncid required" };
    const { data, error } = await ctx.supabase.rpc("get_voter_profile", { p_ncid: ncid });
    if (error) {
      log.warn("agent.get_voter_profile.failed", { ncid, err: error.message });
      return { error: error.message };
    }
    return data;
  }

  return { error: `unknown tool: ${name}` };
}

// ---- Agent loop ----

const SYSTEM = `You are JED, a retrieval and organization tool for a local political campaign.

You have three read-only tools available:
- search_voter_file(query, limit?): find voters in the candidate's lists by fuzzy name match. Use for "the X family", "find Y", "any Smiths in Tenafly".
- recall_conversations(term?, sentiment?, days?, limit?): search the candidate's logged conversations. Use for "who did I talk to about schools", "show me supporters from last week".
- get_voter_profile(ncid): full profile for one voter when the user wants details.

You are NOT an advisor.
- DO: look up specific people, list matches, summarize what the data says.
- DO: when asked about a family or surname, list EVERY entry from search_voter_file as a numbered list (name, address, city, party). Cross-reference with recall_conversations to mark who the candidate has and hasn't talked to yet.
- DON'T: recommend who to call, who to prioritize, or what to focus on.
- DON'T: suggest strategy ("you should...", "I'd recommend...").
- DON'T: invent voters, conversations, or facts that aren't in tool results.

Format the final answer:
- Short prose for simple lookups, numbered list for family/surname questions.
- For each person from search_voter_file: include name, address, city, party. Add "(talked YYYY-MM-DD, sentiment)" if you found a matching conversation, or "(no conversation logged)" otherwise.
- If a tool returns an empty list, say so explicitly. Don't fabricate.
- No filler ("Great question!", "Certainly!"). No markdown headers.`;

export type AgentResponse = {
  answer: string;
  tools_used: string[];
  voter_lookup: Array<{
    ncid: string;
    name: string;
    address: string | null;
    city: string | null;
    party: string | null;
    birth_year: number | null;
  }>;
};

export async function runAgent(
  ctx: ToolContext,
  question: string,
  contextBlob: Record<string, unknown>,
): Promise<AgentResponse> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        `Campaign snapshot (read-only context):\n${JSON.stringify(contextBlob)}\n\n---\n\nQuestion: ${question}`,
    },
  ];

  const toolsUsed: string[] = [];
  // Aggregate every voter that surfaced through search_voter_file. The
  // route surfaces these as quick-add buttons in the UI.
  const voterLookup = new Map<string, AgentResponse["voter_lookup"][number]>();

  for (let step = 0; step < MAX_AGENT_STEPS; step++) {
    const resp = await ai.create(`ask_jed.step_${step}`, {
      model: process.env.JED_MODEL ?? "claude-haiku-4-5",
      max_tokens: 1200,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
    });

    const toolUses = resp.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (resp.stop_reason !== "tool_use" || toolUses.length === 0) {
      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return {
        answer: text || "(empty response)",
        tools_used: toolsUsed,
        voter_lookup: Array.from(voterLookup.values()),
      };
    }

    // Run all requested tools, append the assistant turn + tool_result blocks.
    messages.push({ role: "assistant", content: resp.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const t of toolUses) {
      toolsUsed.push(t.name);
      let value: unknown;
      try {
        value = await runTool(ctx, t.name, t.input);
      } catch (e) {
        value = { error: e instanceof Error ? e.message : "tool error" };
      }
      // If this is a voter search, capture the hits for the UI quick-add list.
      if (t.name === "search_voter_file" && Array.isArray(value)) {
        for (const h of value as Array<Record<string, unknown>>) {
          const ncid = String(h.ncid ?? "");
          if (!ncid) continue;
          if (!voterLookup.has(ncid)) {
            voterLookup.set(ncid, {
              ncid,
              name: String(h.name ?? "(no name)"),
              address: (h.address as string | null) ?? null,
              city: (h.city as string | null) ?? null,
              party: (h.party as string | null) ?? null,
              birth_year: (h.birth_year as number | null) ?? null,
            });
          }
        }
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: t.id,
        content: JSON.stringify(value).slice(0, 30_000),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  // Hit the loop cap without a final answer — return whatever text the model
  // produced last, or a stub.
  log.warn("agent.max_steps", { tools_used: toolsUsed });
  throw new ExternalServiceError("JED could not finish in 4 steps", "anthropic");
}
