import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { extractDebrief, type Participant } from "@/lib/ai/debrief";

export const runtime = "nodejs";

type VoterMatch = {
  ncid: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  res_street_address: string | null;
  res_city: string | null;
  confidence: number;
};

type ParticipantResult = {
  participant_id: string;
  captured_name: string;
  voter_ncid: string | null;
  match_confidence: number | null;
  candidates: VoterMatch[];
};

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const transcript = (body.transcript as string | undefined)?.trim();
  if (!transcript || transcript.length < 10) {
    return Response.json({ error: "transcript too short" }, { status: 400 });
  }

  // 1. Extract structure (now includes participants[])
  let extract;
  try {
    extract = await extractDebrief(transcript);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }

  // 2. Per-participant fuzzy match
  const participantsWithMatches = await Promise.all(
    extract.participants.map(async (p, idx) => {
      let candidates: VoterMatch[] = [];
      if (p.name && p.name.length >= 3) {
        const { data } = await supabase.rpc("match_voters", { q: p.name, max_results: 5 });
        candidates = (data as VoterMatch[] | null) ?? [];
      }
      const top = candidates[0];
      const picked = top && top.confidence >= 0.5 ? top : null;
      return {
        ...p,
        is_primary: idx === 0,
        candidates,
        picked_ncid: picked?.ncid ?? null,
        confidence: top?.confidence ?? null,
      };
    }),
  );

  const lead = participantsWithMatches[0];

  // 3. Insert the parent interaction. The interaction-level captured_name and
  //    sentiment mirror the lead participant for back-compat with anything
  //    still reading directly from interactions.
  const { data: inserted, error: insErr } = await supabase
    .from("interactions")
    .insert({
      user_id: user.id,
      voter_ncid: lead.picked_ncid,
      captured_name: lead.name || "(from debrief)",
      captured_location: extract.captured_location,
      notes: extract.cleaned_notes,
      issues: lead.issues,
      sentiment: lead.sentiment,
      tags: [
        ...lead.tags,
        ...(extract.wants_sign ? ["wants-yard-sign"] : []),
        ...(extract.wants_to_volunteer ? ["volunteer-interest"] : []),
      ],
      match_confidence: lead.confidence,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    return Response.json({ error: insErr?.message ?? "insert failed" }, { status: 500 });
  }
  const interactionId = inserted.id as string;

  // 4. Insert one participant row per extracted person.
  const participantRows = participantsWithMatches.map((p) => ({
    interaction_id: interactionId,
    voter_ncid: p.picked_ncid,
    captured_name: p.name || "(no name)",
    relationship: p.relationship || null,
    sentiment: p.sentiment,
    issues: p.issues,
    tags: p.tags,
    notes: p.notes || null,
    match_confidence: p.confidence,
    is_primary: p.is_primary,
  }));
  const { data: insertedParticipants, error: pErr } = await supabase
    .from("interaction_participants")
    .insert(participantRows)
    .select("id, captured_name, voter_ncid, match_confidence");
  if (pErr) {
    return Response.json({ error: `participant insert failed: ${pErr.message}` }, { status: 500 });
  }

  // 5. Household edges: any two MATCHED participants in the same conversation
  //    are now linked. Symmetric — store smaller ncid first.
  const matchedNcids = participantsWithMatches
    .filter((p) => p.picked_ncid)
    .map((p) => p.picked_ncid as string);
  if (matchedNcids.length >= 2) {
    const edges: Array<{ user_id: string; voter_a: string; voter_b: string; source_interaction_id: string }> = [];
    for (let i = 0; i < matchedNcids.length; i++) {
      for (let j = i + 1; j < matchedNcids.length; j++) {
        const a = matchedNcids[i];
        const b = matchedNcids[j];
        if (a === b) continue;
        const [voter_a, voter_b] = a < b ? [a, b] : [b, a];
        edges.push({
          user_id: user.id,
          voter_a,
          voter_b,
          source_interaction_id: interactionId,
        });
      }
    }
    if (edges.length) {
      await supabase
        .from("household_links")
        .upsert(edges, { onConflict: "user_id,voter_a,voter_b", ignoreDuplicates: true });
    }
  }

  // 6. Return per-participant matches so the UI can show a "did you mean?"
  //    prompt for any participant whose top match is below confidence.
  const result: ParticipantResult[] = (insertedParticipants ?? []).map((row, idx) => ({
    participant_id: row.id as string,
    captured_name: row.captured_name as string,
    voter_ncid: row.voter_ncid as string | null,
    match_confidence: row.match_confidence as number | null,
    candidates: participantsWithMatches[idx].candidates,
  }));

  return Response.json({
    ok: true,
    interaction_id: interactionId,
    extract,
    participants: result,
  });
}
