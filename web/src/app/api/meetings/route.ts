import { NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServer } from "@/lib/supabase/server";
import { parseOrThrow } from "@/lib/parseOrThrow";
import { makeRequestLogger, newRequestId } from "@/lib/logger";
import { errorToResponse, UnauthorizedError } from "@/domain/errors";

export const runtime = "nodejs";

const CreateSchema = z.object({
  title:        z.string().min(1).max(200),
  body:         z.string().max(20000).nullable().optional(),
  meeting_date: z.string().datetime().nullable().optional(),
  duration_min: z.number().int().min(0).max(1440).nullable().optional(),
  location:     z.string().max(200).nullable().optional(),
  attendees:    z.array(z.string().min(1).max(200)).max(50).optional(),
  tags:         z.array(z.string().min(1).max(60)).max(20).optional(),
});

export async function POST(req: NextRequest) {
  const requestId = newRequestId();
  const rlog = makeRequestLogger({ request_id: requestId, route: "POST /api/meetings" });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError("not signed in");

    const body = await req.json().catch(() => ({}));
    const input = parseOrThrow(CreateSchema, body);

    const { data, error } = await supabase
      .from("meeting_notes")
      .insert({
        user_id: user.id,
        created_by: user.id,
        title: input.title,
        body: input.body ?? null,
        meeting_date: input.meeting_date ?? null,
        duration_min: input.duration_min ?? null,
        location: input.location ?? null,
        attendees: input.attendees ?? null,
        tags: input.tags ?? null,
      })
      .select("id, title, meeting_date, created_at")
      .single();
    if (error) throw new Error(error.message);

    rlog.info("meeting.create.ok", { user_id: user.id, meeting_id: data?.id });
    return Response.json(
      { ok: true, meeting: data },
      { headers: { "x-request-id": requestId } },
    );
  } catch (e) {
    rlog.error("meeting.create.failed", { err: e instanceof Error ? e.message : String(e) });
    const resp = errorToResponse(e);
    resp.headers.set("x-request-id", requestId);
    return resp;
  }
}
