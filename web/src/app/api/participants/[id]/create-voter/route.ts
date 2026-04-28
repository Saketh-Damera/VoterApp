import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Manually create a voter for a participant that did not match the file.
// The new voter goes into a per-user "Manual entries" list (created lazily)
// so it doesn't pollute uploaded lists, and the participant is linked to it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const first_name = (body.first_name as string | undefined)?.trim() || null;
  const last_name = (body.last_name as string | undefined)?.trim() || null;
  if (!first_name && !last_name) {
    return Response.json({ error: "first_name or last_name required" }, { status: 400 });
  }
  const middle_name = (body.middle_name as string | undefined)?.trim() || null;
  const res_street_address = (body.res_street_address as string | undefined)?.trim() || null;
  const res_city = (body.res_city as string | undefined)?.trim() || null;
  const res_zip = (body.res_zip as string | undefined)?.trim() || null;
  const party_cd = (body.party_cd as string | undefined)?.trim().toUpperCase() || null;
  const birth_year_raw = body.birth_year;
  const birth_year =
    typeof birth_year_raw === "number" && birth_year_raw > 1900 && birth_year_raw < 2100
      ? birth_year_raw
      : null;

  // Verify the participant belongs to the caller and grab interaction context.
  const { data: participant, error: pErr } = await supabase
    .from("interaction_participants")
    .select("id, interaction_id, voter_ncid, captured_name")
    .eq("id", id)
    .single();
  if (pErr || !participant) {
    return Response.json({ error: pErr?.message ?? "participant not found" }, { status: 404 });
  }
  if (participant.voter_ncid) {
    return Response.json({ error: "participant already linked" }, { status: 400 });
  }

  // Find or create the per-user "Manual entries" list.
  let manualListId: string;
  const { data: existingList } = await supabase
    .from("voter_lists")
    .select("id")
    .eq("user_id", user.id)
    .eq("name", "Manual entries")
    .maybeSingle();
  if (existingList) {
    manualListId = existingList.id as string;
  } else {
    const { data: newList, error: lErr } = await supabase
      .from("voter_lists")
      .insert({
        user_id: user.id,
        name: "Manual entries",
        source_filename: null,
        row_count: 0,
        race_type: "unspecified",
      })
      .select("id")
      .single();
    if (lErr || !newList) {
      return Response.json({ error: lErr?.message ?? "could not create Manual entries list" }, { status: 500 });
    }
    manualListId = newList.id as string;
  }

  // Mint a deterministic ncid: M:<sha1(user_id|first|last|address|city)>
  const key = [user.id, last_name ?? "", first_name ?? "", res_street_address ?? "", res_city ?? ""]
    .map((s) => s.toLowerCase().trim())
    .join("|");
  const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 16);
  const ncid = `M:${hash}`;

  // Upsert the voter (idempotent if the user creates the same person twice).
  const { error: vErr } = await supabase
    .from("voters")
    .upsert({
      ncid,
      list_id: manualListId,
      first_name,
      middle_name,
      last_name,
      res_street_address,
      res_city,
      res_zip,
      party_cd,
      birth_year,
    }, { onConflict: "ncid", ignoreDuplicates: false });
  if (vErr) return Response.json({ error: `voter create failed: ${vErr.message}` }, { status: 500 });

  // Membership row in the manual list (idempotent).
  await supabase
    .from("voter_list_members")
    .upsert({ list_id: manualListId, voter_ncid: ncid }, { onConflict: "list_id,voter_ncid", ignoreDuplicates: true });

  // Bump the manual list's row_count to keep the /lists view honest.
  const { count: memberCount } = await supabase
    .from("voter_list_members")
    .select("*", { count: "exact", head: true })
    .eq("list_id", manualListId);
  if (memberCount !== null) {
    await supabase.from("voter_lists").update({ row_count: memberCount }).eq("id", manualListId);
  }

  // Link the participant.
  const { error: linkErr } = await supabase
    .from("interaction_participants")
    .update({ voter_ncid: ncid, match_confidence: 1.0 })
    .eq("id", id);
  if (linkErr) return Response.json({ error: `link failed: ${linkErr.message}` }, { status: 500 });

  // If primary, mirror to parent interaction.
  await supabase
    .from("interactions")
    .update({ voter_ncid: ncid, match_confidence: 1.0 })
    .eq("id", participant.interaction_id)
    .eq("voter_ncid", null as unknown as string); // safe no-op if already linked

  return Response.json({ ok: true, ncid, list_id: manualListId });
}
