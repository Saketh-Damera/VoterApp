import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Manual one-person conversation entry from /people/new. Goes through
// record_conversation so the interaction + participant insert is atomic and
// the audit trigger fires once.
export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const captured_name = (body.captured_name as string | undefined)?.trim();
  if (!captured_name) {
    return Response.json({ error: "captured_name required" }, { status: 400 });
  }
  const captured_location = (body.captured_location as string | undefined)?.trim() || null;
  const notes = (body.notes as string | undefined)?.trim() || null;
  const voter_ncid = (body.voter_ncid as string | undefined) || null;
  const match_confidence_raw = body.match_confidence;
  const match_confidence =
    typeof match_confidence_raw === "number" ? match_confidence_raw : null;

  const { data: rpcResult, error } = await supabase.rpc("record_conversation", {
    p_user_id: user.id,
    p_captured_location: captured_location,
    p_notes: notes,
    p_participants: [
      {
        captured_name,
        voter_ncid,
        sentiment: null,
        issues: [],
        tags: [],
        notes,
        match_confidence,
        is_primary: true,
      },
    ],
    p_extra_tags: [],
  });
  if (error || !rpcResult) {
    return Response.json({ error: error?.message ?? "save failed" }, { status: 500 });
  }
  return Response.json({ ok: true, ...(rpcResult as Record<string, unknown>) });
}
