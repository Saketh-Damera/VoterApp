import { NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServer } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { parseOrThrow } from "@/lib/parseOrThrow";
import { makeRequestLogger, newRequestId } from "@/lib/logger";
import { errorToResponse, RateLimitError, UnauthorizedError } from "@/domain/errors";
import { describeToFilter, buildCohort } from "@/domain/ai/cohortBuilder";

export const runtime = "nodejs";

const BodySchema = z.object({
  description: z.string().min(3).max(2000),
  list_id: z.string().uuid().nullable().optional(),
  limit: z.number().int().min(1).max(5000).optional(),
});

export async function POST(req: NextRequest) {
  const requestId = newRequestId();
  const rlog = makeRequestLogger({ request_id: requestId, route: "POST /api/cohorts/build" });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError("not signed in");

    const limited = await checkRateLimit(supabase, user.id, "cohort_build", 30, 60);
    if (!limited.ok) throw new RateLimitError(limited.message, limited.retryAfter);

    const body = await req.json().catch(() => ({}));
    const { description, list_id, limit } = parseOrThrow(BodySchema, body);

    rlog.info("cohort.start", { user_id: user.id, desc_len: description.length });
    const filter = await describeToFilter(description);
    const voters = await buildCohort(supabase, filter, { listId: list_id ?? null, limit });

    rlog.info("cohort.done", {
      user_id: user.id,
      filter,
      result_count: voters.length,
    });
    return Response.json(
      { ok: true, filter, voters },
      { headers: { "x-request-id": requestId } },
    );
  } catch (e) {
    rlog.error("cohort.failed", { err: e instanceof Error ? e.message : String(e) });
    const resp = errorToResponse(e);
    resp.headers.set("x-request-id", requestId);
    return resp;
  }
}
