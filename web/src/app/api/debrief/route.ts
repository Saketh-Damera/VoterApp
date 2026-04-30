import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { parseOrThrow } from "@/lib/parseOrThrow";
import { makeRequestLogger, newRequestId } from "@/lib/logger";
import { errorToResponse, RateLimitError, UnauthorizedError } from "@/domain/errors";
import { recordDebrief } from "@/domain/conversations";
import { DebriefRequestSchema } from "@/domain/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const requestId = newRequestId();
  const rlog = makeRequestLogger({ request_id: requestId, route: "POST /api/debrief" });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError("not signed in");

    const limited = await checkRateLimit(supabase, user.id, "debrief", 60, 60);
    if (!limited.ok) throw new RateLimitError(limited.message, limited.retryAfter);

    const body = await req.json().catch(() => ({}));
    const { transcript } = parseOrThrow(DebriefRequestSchema, body);

    rlog.info("debrief.start", { user_id: user.id, transcript_chars: transcript.length });
    const result = await recordDebrief(supabase, user, transcript);
    rlog.info("debrief.done", {
      user_id: user.id,
      interaction_id: result.interaction_id,
      participants: result.participants.length,
    });

    return Response.json(
      {
        ok: true,
        interaction_id: result.interaction_id,
        extract: result.extract,
        participants: result.participants,
      },
      { headers: { "x-request-id": requestId } },
    );
  } catch (e) {
    rlog.error("debrief.failed", {
      err: e instanceof Error ? e.message : String(e),
      kind: e instanceof Error ? e.constructor.name : "unknown",
    });
    const resp = errorToResponse(e);
    resp.headers.set("x-request-id", requestId);
    return resp;
  }
}
