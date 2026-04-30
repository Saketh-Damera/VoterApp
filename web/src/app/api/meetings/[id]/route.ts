import { NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServer } from "@/lib/supabase/server";
import { parseOrThrow } from "@/lib/parseOrThrow";
import { makeRequestLogger, newRequestId } from "@/lib/logger";
import { errorToResponse, NotFoundError, UnauthorizedError } from "@/domain/errors";

export const runtime = "nodejs";

const PatchSchema = z.object({
  title:        z.string().min(1).max(200).optional(),
  body:         z.string().max(20000).nullable().optional(),
  meeting_date: z.string().datetime().nullable().optional(),
  duration_min: z.number().int().min(0).max(1440).nullable().optional(),
  location:     z.string().max(200).nullable().optional(),
  attendees:    z.array(z.string().min(1).max(200)).max(50).optional(),
  tags:         z.array(z.string().min(1).max(60)).max(20).optional(),
}).refine((p) => Object.keys(p).length > 0, { message: "no fields to update" });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = newRequestId();
  const { id } = await params;
  const rlog = makeRequestLogger({
    request_id: requestId,
    route: "PATCH /api/meetings/[id]",
    meeting_id: id,
  });
  try {
    if (!id) throw new NotFoundError("missing meeting id");
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError("not signed in");

    const body = await req.json().catch(() => ({}));
    const patch = parseOrThrow(PatchSchema, body);

    const { error } = await supabase
      .from("meeting_notes")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(error.message);

    rlog.info("meeting.patch.ok", { user_id: user.id });
    return Response.json({ ok: true }, { headers: { "x-request-id": requestId } });
  } catch (e) {
    rlog.error("meeting.patch.failed", { err: e instanceof Error ? e.message : String(e) });
    const resp = errorToResponse(e);
    resp.headers.set("x-request-id", requestId);
    return resp;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = newRequestId();
  const { id } = await params;
  const rlog = makeRequestLogger({
    request_id: requestId,
    route: "DELETE /api/meetings/[id]",
    meeting_id: id,
  });
  try {
    if (!id) throw new NotFoundError("missing meeting id");
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError("not signed in");

    const { error } = await supabase.from("meeting_notes").delete().eq("id", id);
    if (error) throw new Error(error.message);

    rlog.info("meeting.delete.ok", { user_id: user.id });
    return Response.json({ ok: true }, { headers: { "x-request-id": requestId } });
  } catch (e) {
    rlog.error("meeting.delete.failed", { err: e instanceof Error ? e.message : String(e) });
    const resp = errorToResponse(e);
    resp.headers.set("x-request-id", requestId);
    return resp;
  }
}
