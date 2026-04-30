import { NextRequest } from "next/server";
import { z } from "zod";
import { getSupabaseServer } from "@/lib/supabase/server";
import { parseOrThrow } from "@/lib/parseOrThrow";
import { makeRequestLogger, newRequestId } from "@/lib/logger";
import { errorToResponse, ForbiddenError, NotFoundError, UnauthorizedError } from "@/domain/errors";

export const runtime = "nodejs";

const CreateInviteSchema = z.object({
  email: z.string().email().nullable().optional(),
});

// Generate a signed invite link for a volunteer group. RLS scopes the
// volunteer_invites table to the group owner, so this implicitly verifies
// ownership.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = newRequestId();
  const { id } = await params;
  const rlog = makeRequestLogger({
    request_id: requestId,
    route: "POST /api/volunteer-groups/[id]/invites",
    group_id: id,
  });
  try {
    if (!id) throw new NotFoundError("missing group id");
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError("not signed in");

    // Verify ownership explicitly so we get a clear 403 on mismatch (RLS
    // would silently filter the insert otherwise).
    const { data: group } = await supabase
      .from("volunteer_groups")
      .select("id, owner_id, name")
      .eq("id", id)
      .maybeSingle();
    if (!group) throw new NotFoundError("group not found");
    if (group.owner_id !== user.id) throw new ForbiddenError("not the group owner");

    const body = await req.json().catch(() => ({}));
    const { email } = parseOrThrow(CreateInviteSchema, body);

    const { data: invite, error } = await supabase
      .from("volunteer_invites")
      .insert({ group_id: id, email: email ?? null })
      .select("id, invite_code, email, expires_at")
      .single();
    if (error || !invite) throw new Error(error?.message ?? "insert failed");

    rlog.info("vi.create.ok", { user_id: user.id });
    return Response.json(
      {
        ok: true,
        invite,
        invite_url: buildInviteUrl(req, invite.invite_code as string),
      },
      { headers: { "x-request-id": requestId } },
    );
  } catch (e) {
    rlog.error("vi.create.failed", { err: e instanceof Error ? e.message : String(e) });
    const resp = errorToResponse(e);
    resp.headers.set("x-request-id", requestId);
    return resp;
  }
}

function buildInviteUrl(req: NextRequest, code: string): string {
  const url = new URL(req.url);
  return `${url.origin}/invites/${code}`;
}
