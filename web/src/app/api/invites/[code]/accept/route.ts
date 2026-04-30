import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { makeRequestLogger, newRequestId } from "@/lib/logger";
import { errorToResponse, NotFoundError, UnauthorizedError, ConflictError } from "@/domain/errors";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const requestId = newRequestId();
  const { code } = await params;
  const rlog = makeRequestLogger({
    request_id: requestId,
    route: "POST /api/invites/[code]/accept",
  });
  try {
    if (!code) throw new NotFoundError("missing invite code");
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError("not signed in");

    // RLS on volunteer_invites only lets the GROUP OWNER read by default —
    // the invitee won't be able to look it up directly. Use a service-role
    // path to read the invite. We don't have a service role on this client,
    // so instead we update the invite row directly and let it fail if the
    // code doesn't exist or is expired. The unique invite_code index makes
    // this lookup safe.
    //
    // The simplest workable design: an RPC that runs as security definer
    // and atomically (a) verifies the code, (b) inserts the membership, and
    // (c) marks the invite accepted.
    const { data, error } = await supabase.rpc("accept_volunteer_invite", { p_code: code });
    if (error) {
      if (error.message.includes("not found")) throw new NotFoundError(error.message);
      if (error.message.includes("expired") || error.message.includes("already")) {
        throw new ConflictError(error.message);
      }
      throw new Error(error.message);
    }

    rlog.info("vi.accept.ok", { user_id: user.id, group_id: data });
    return Response.json(
      { ok: true, group_id: data },
      { headers: { "x-request-id": requestId } },
    );
  } catch (e) {
    rlog.error("vi.accept.failed", { err: e instanceof Error ? e.message : String(e) });
    const resp = errorToResponse(e);
    resp.headers.set("x-request-id", requestId);
    return resp;
  }
}
