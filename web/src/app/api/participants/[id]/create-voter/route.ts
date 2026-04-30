import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { parseOrThrow } from "@/lib/parseOrThrow";
import { makeRequestLogger, newRequestId } from "@/lib/logger";
import { errorToResponse, UnauthorizedError, ValidationError } from "@/domain/errors";
import { createManualVoter } from "@/domain/conversations";
import { CreateManualVoterSchema } from "@/domain/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = newRequestId();
  const { id } = await params;
  const rlog = makeRequestLogger({
    request_id: requestId,
    route: "POST /api/participants/[id]/create-voter",
    participant_id: id,
  });
  try {
    if (!id) throw new ValidationError("missing participant id", { id: "required" });
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError("not signed in");

    const body = await req.json().catch(() => ({}));
    const input = parseOrThrow(CreateManualVoterSchema, body);

    const out = await createManualVoter(supabase, user, id, {
      first_name: input.first_name ?? null,
      last_name: input.last_name ?? null,
      middle_name: input.middle_name ?? null,
      res_street_address: input.res_street_address ?? null,
      res_city: input.res_city ?? null,
      res_zip: input.res_zip ?? null,
      party_cd: input.party_cd ? input.party_cd.toUpperCase() : null,
      birth_year: input.birth_year ?? null,
    });

    rlog.info("create_manual_voter.ok", { user_id: user.id, ...out });
    return Response.json({ ok: true, ...out }, { headers: { "x-request-id": requestId } });
  } catch (e) {
    rlog.error("create_manual_voter.failed", {
      err: e instanceof Error ? e.message : String(e),
    });
    const resp = errorToResponse(e);
    resp.headers.set("x-request-id", requestId);
    return resp;
  }
}
