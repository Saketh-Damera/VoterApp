import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { parseOrThrow } from "@/lib/parseOrThrow";
import { makeRequestLogger, newRequestId } from "@/lib/logger";
import { errorToResponse, RateLimitError, UnauthorizedError } from "@/domain/errors";
import { runAgent } from "@/domain/ai/agent";
import { AskJedRequestSchema } from "@/domain/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const requestId = newRequestId();
  const rlog = makeRequestLogger({ request_id: requestId, route: "POST /api/ask-jed" });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError("not signed in");

    const limited = await checkRateLimit(supabase, user.id, "ask_jed", 100, 60);
    if (!limited.ok) throw new RateLimitError(limited.message, limited.retryAfter);

    const body = await req.json().catch(() => ({}));
    const { question } = parseOrThrow(AskJedRequestSchema, body);

    // Minimal context blob — the agent calls tools for everything else. We
    // include just enough that the model knows whose campaign it's working on.
    const [{ data: candidate }, { data: stats }] = await Promise.all([
      supabase
        .from("candidates")
        .select("candidate_name, office, jurisdiction, election_date, race_type")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase.rpc("dashboard_stats"),
    ]);
    const election_days_left = candidate?.election_date
      ? Math.round(
          (new Date(candidate.election_date as string).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24),
        )
      : null;

    rlog.info("ask_jed.start", { user_id: user.id, q_chars: question.length });
    const result = await runAgent(
      { supabase, userId: user.id },
      question,
      { candidate, election_days_left, stats },
    );

    // Annotate voter_lookup so the UI can show "Already in contacts" chips.
    const ncids = result.voter_lookup.map((v) => v.ncid);
    let alreadyContactedNcids = new Set<string>();
    if (ncids.length > 0) {
      const { data: existing } = await supabase
        .from("interaction_participants")
        .select("voter_ncid, interactions!inner(user_id)")
        .eq("interactions.user_id", user.id)
        .in("voter_ncid", ncids);
      type ExRow = { voter_ncid: string | null };
      alreadyContactedNcids = new Set(
        ((existing ?? []) as ExRow[])
          .map((r) => r.voter_ncid)
          .filter((x): x is string => !!x),
      );
    }
    const annotated = result.voter_lookup.map((v) => ({
      ...v,
      already_contacted: alreadyContactedNcids.has(v.ncid),
    }));

    rlog.info("ask_jed.done", {
      user_id: user.id,
      tools_used: result.tools_used,
      voters_found: annotated.length,
    });

    return Response.json(
      {
        ok: true,
        answer: result.answer,
        voter_lookup: annotated,
        tools_used: result.tools_used,
      },
      { headers: { "x-request-id": requestId } },
    );
  } catch (e) {
    rlog.error("ask_jed.failed", { err: e instanceof Error ? e.message : String(e) });
    const resp = errorToResponse(e);
    resp.headers.set("x-request-id", requestId);
    return resp;
  }
}
