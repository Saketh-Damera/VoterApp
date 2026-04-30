import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { parseOrThrow } from "@/lib/parseOrThrow";
import { makeRequestLogger, newRequestId } from "@/lib/logger";
import { errorToResponse, UnauthorizedError } from "@/domain/errors";
import { manualEntry } from "@/domain/conversations";
import { ManualEntryRequestSchema } from "@/domain/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const requestId = newRequestId();
  const rlog = makeRequestLogger({
    request_id: requestId,
    route: "POST /api/interactions/manual",
  });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError("not signed in");

    const body = await req.json().catch(() => ({}));
    const input = parseOrThrow(ManualEntryRequestSchema, body);

    const result = await manualEntry(supabase, user, {
      captured_name: input.captured_name,
      captured_location: input.captured_location ?? null,
      notes: input.notes ?? null,
      voter_ncid: input.voter_ncid ?? null,
      match_confidence: input.match_confidence ?? null,
    });

    rlog.info("manual_entry.ok", { user_id: user.id, ...result });
    return Response.json(
      { ok: true, ...result },
      { headers: { "x-request-id": requestId } },
    );
  } catch (e) {
    rlog.error("manual_entry.failed", {
      err: e instanceof Error ? e.message : String(e),
    });
    const resp = errorToResponse(e);
    resp.headers.set("x-request-id", requestId);
    return resp;
  }
}
