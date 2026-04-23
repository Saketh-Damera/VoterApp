import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { analyzeNotes } from "@/lib/enrich/analyze";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data: interaction, error: selErr } = await supabase
    .from("interactions")
    .select("id, notes, voter_ncid")
    .eq("id", id)
    .single();
  if (selErr || !interaction) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (!interaction.notes || interaction.notes.trim().length < 4) {
    return Response.json({ ok: true, skipped: "notes_too_short" });
  }

  let analysis;
  try {
    analysis = await analyzeNotes(interaction.notes);
  } catch (err) {
    console.error("analyzeNotes failed", err);
    return Response.json({ error: "analysis_failed" }, { status: 502 });
  }

  const { error: upErr } = await supabase
    .from("interactions")
    .update({
      issues: analysis.issues,
      sentiment: analysis.sentiment,
      tags: analysis.tags,
    })
    .eq("id", id);
  if (upErr) {
    return Response.json({ error: "update_failed", detail: upErr.message }, { status: 500 });
  }

  if (analysis.follow_up && interaction.voter_ncid) {
    const due = new Date();
    due.setDate(due.getDate() + analysis.follow_up.days_until);
    await supabase.from("reminders").insert({
      user_id: user.id,
      interaction_id: id,
      voter_ncid: interaction.voter_ncid,
      due_at: due.toISOString(),
      message: analysis.follow_up.action,
    });
  }

  return Response.json({ ok: true, analysis });
}
