import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { extractDebrief } from "@/lib/ai/debrief";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const transcript = (body.transcript as string | undefined)?.trim();
  if (!transcript || transcript.length < 10) {
    return Response.json({ error: "transcript too short" }, { status: 400 });
  }

  // 1. Extract structure with Claude
  let extract;
  try {
    extract = await extractDebrief(transcript);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }

  // 2. Fuzzy match on the extracted name (if any)
  let matches: Array<{
    ncid: string;
    first_name: string | null;
    middle_name: string | null;
    last_name: string | null;
    res_street_address: string | null;
    res_city: string | null;
    confidence: number;
  }> = [];
  if (extract.captured_name && extract.captured_name.length >= 3) {
    const { data } = await supabase.rpc("match_voters", {
      q: extract.captured_name,
      max_results: 5,
    });
    matches = (data as typeof matches) ?? [];
  }

  const topMatch = matches[0];
  const pickedNcid = topMatch && topMatch.confidence >= 0.5 ? topMatch.ncid : null;

  // 3. Insert interaction with the structured data already populated
  const { data: inserted, error: insErr } = await supabase
    .from("interactions")
    .insert({
      user_id: user.id,
      voter_ncid: pickedNcid,
      captured_name: extract.captured_name || "(from debrief)",
      captured_location: extract.captured_location,
      notes: extract.cleaned_notes,
      issues: extract.issues,
      sentiment: extract.sentiment,
      tags: [
        ...extract.tags,
        ...(extract.wants_sign ? ["wants-yard-sign"] : []),
        ...(extract.wants_to_volunteer ? ["volunteer-interest"] : []),
      ],
      match_confidence: topMatch?.confidence ?? null,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    return Response.json({ error: insErr?.message ?? "insert failed" }, { status: 500 });
  }

  // Mentioned people are surfaced in the response so the candidate can see who
  // came up — but we no longer auto-create reminders or todos for them.

  return Response.json({
    ok: true,
    interaction_id: inserted.id,
    voter_ncid: pickedNcid,
    extract,
    match_candidates: matches,
    todos_created: 0,
  });
}
