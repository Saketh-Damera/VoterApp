import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { parseOrThrow } from "@/lib/parseOrThrow";
import { makeRequestLogger, newRequestId } from "@/lib/logger";
import { errorToResponse, UnauthorizedError, ValidationError } from "@/domain/errors";
import { updateParticipant } from "@/domain/conversations";
import { ParticipantPatchSchema } from "@/domain/types";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = newRequestId();
  const { id } = await params;
  const rlog = makeRequestLogger({
    request_id: requestId,
    route: "PATCH /api/participants/[id]",
    participant_id: id,
  });
  try {
    if (!id) throw new ValidationError("missing participant id", { id: "required" });
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError("not signed in");

    const body = await req.json().catch(() => ({}));
    const patch = parseOrThrow(ParticipantPatchSchema, body) as Record<string, unknown>;

    await updateParticipant(supabase, id, patch);
    rlog.info("participant_patch.ok", { user_id: user.id, fields: Object.keys(patch) });
    return Response.json(
      { ok: true },
      { headers: { "x-request-id": requestId } },
    );
  } catch (e) {
    rlog.error("participant_patch.failed", {
      err: e instanceof Error ? e.message : String(e),
    });
    const resp = errorToResponse(e);
    resp.headers.set("x-request-id", requestId);
    return resp;
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = newRequestId();
  const { id } = await params;
  const rlog = makeRequestLogger({
    request_id: requestId,
    route: "DELETE /api/participants/[id]",
    participant_id: id,
  });
  try {
    if (!id) throw new ValidationError("missing participant id", { id: "required" });
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError("not signed in");

    const { error } = await supabase
      .from("interaction_participants")
      .delete()
      .eq("id", id);
    if (error) throw new ValidationError(error.message);

    rlog.info("participant_delete.ok", { user_id: user.id });
    return Response.json({ ok: true }, { headers: { "x-request-id": requestId } });
  } catch (e) {
    rlog.error("participant_delete.failed", {
      err: e instanceof Error ? e.message : String(e),
    });
    const resp = errorToResponse(e);
    resp.headers.set("x-request-id", requestId);
    return resp;
  }
}
