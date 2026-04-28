import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const ALLOWED = new Set([
  "voter_ncid",
  "sentiment",
  "notes",
  "issues",
  "tags",
  "captured_name",
  "relationship",
  "match_confidence",
]);

// Patch a participant. RLS already restricts edits to participants whose
// parent interaction is owned by the caller. If the participant is_primary,
// mirror voter_ncid + sentiment back to the parent interaction so any reads
// still hitting the legacy columns stay consistent.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(body)) {
    if (ALLOWED.has(k)) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "no allowed fields in payload" }, { status: 400 });
  }
  // Manual link: caller picked a voter from a list — set match_confidence = 1.0
  if ("voter_ncid" in patch && patch.voter_ncid && !("match_confidence" in patch)) {
    patch.match_confidence = 1.0;
  }
  if ("voter_ncid" in patch && patch.voter_ncid === null) {
    patch.match_confidence = null;
  }

  const { data: updated, error } = await supabase
    .from("interaction_participants")
    .update(patch)
    .eq("id", id)
    .select("id, interaction_id, voter_ncid, sentiment, is_primary")
    .single();
  if (error || !updated) {
    return Response.json({ error: error?.message ?? "update failed" }, { status: 400 });
  }

  // Mirror to parent interaction for the primary participant only.
  if (updated.is_primary) {
    const mirror: Record<string, unknown> = {};
    if ("voter_ncid" in patch) mirror.voter_ncid = updated.voter_ncid;
    if ("sentiment" in patch) mirror.sentiment = updated.sentiment;
    if ("match_confidence" in patch) mirror.match_confidence = patch.match_confidence;
    if (Object.keys(mirror).length) {
      await supabase.from("interactions").update(mirror).eq("id", updated.interaction_id);
    }
  }

  return Response.json({ ok: true, participant: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase.from("interaction_participants").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
