import { NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServer } from "@/lib/supabase/server";
import { parseOrThrow } from "@/lib/parseOrThrow";
import { makeRequestLogger, newRequestId } from "@/lib/logger";
import { errorToResponse, UnauthorizedError } from "@/domain/errors";

export const runtime = "nodejs";

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const requestId = newRequestId();
  const rlog = makeRequestLogger({ request_id: requestId, route: "POST /api/volunteer-groups" });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError("not signed in");

    const body = await req.json().catch(() => ({}));
    const input = parseOrThrow(CreateSchema, body);

    const { data, error } = await supabase
      .from("volunteer_groups")
      .insert({ owner_id: user.id, name: input.name, description: input.description ?? null })
      .select("id, name, description, created_at")
      .single();
    if (error) throw new Error(error.message);

    rlog.info("vg.create.ok", { user_id: user.id, group_id: data?.id });
    return Response.json({ ok: true, group: data }, { headers: { "x-request-id": requestId } });
  } catch (e) {
    rlog.error("vg.create.failed", { err: e instanceof Error ? e.message : String(e) });
    const resp = errorToResponse(e);
    resp.headers.set("x-request-id", requestId);
    return resp;
  }
}
