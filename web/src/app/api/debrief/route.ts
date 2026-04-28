import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { extractDebrief } from "@/lib/ai/debrief";
import { checkRateLimit } from "@/lib/rateLimit";

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

  const limited = await checkRateLimit(supabase, user.id, "debrief", 60, 60);
  if (!limited.ok) {
    return Response.json(
      { error: `rate limit: ${limited.message}` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfter) } },
    );
  }

  const body = await req.json();
  const transcript = (body.transcript as string | undefined)?.trim();
  if (!transcript || transcript.length < 10) {
    return Response.json({ error: "transcript too short" }, { status: 400 });
  }

  // 1. Extract structure
  let extract;
  try {
    extract = await extractDebrief(transcript);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }

  // 2. Per-participant fuzzy match (in parallel)
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
        participant: p,
        index: idx,
        candidates,
        picked_ncid: picked?.ncid ?? null,
        confidence: top?.confidence ?? null,
      };
    }),
  );

  // 3. Atomic write via record_conversation RPC. The RPC inserts the parent
  //    interaction, all participant rows, and any household_links edges in a
  //    single transaction — no orphan parent if a participant insert fails.
  const participantsPayload = participantsWithMatches.map((p) => ({
    captured_name: p.participant.name || "(no name)",
    voter_ncid: p.picked_ncid,
    relationship: p.participant.relationship || null,
    sentiment: p.participant.sentiment,
    issues: p.participant.issues,
    tags: p.participant.tags,
    notes: p.participant.notes || null,
    match_confidence: p.confidence,
    is_primary: p.index === 0,
  }));

  const extraTags: string[] = [
    ...(extract.wants_sign ? ["wants-yard-sign"] : []),
    ...(extract.wants_to_volunteer ? ["volunteer-interest"] : []),
  ];

  const { data: rpcResult, error: rpcErr } = await supabase.rpc("record_conversation", {
    p_user_id: user.id,
    p_captured_location: extract.captured_location,
    p_notes: extract.cleaned_notes,
    p_participants: participantsPayload,
    p_extra_tags: extraTags,
  });
  if (rpcErr || !rpcResult) {
    return Response.json(
      { error: `record_conversation failed: ${rpcErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  const { interaction_id, participant_ids } = rpcResult as {
    interaction_id: string;
    participant_ids: string[];
  };

  // 4. Build the per-participant response so the UI can show "did you mean?"
  //    panels for any participant whose match is uncertain.
  const result: ParticipantResult[] = participantsWithMatches.map((p, idx) => ({
    participant_id: participant_ids[idx],
    captured_name: p.participant.name || "(no name)",
    voter_ncid: p.picked_ncid,
    match_confidence: p.confidence,
    candidates: p.candidates,
  }));

  return Response.json({
    ok: true,
    interaction_id,
    extract,
    participants: result,
  });
}
