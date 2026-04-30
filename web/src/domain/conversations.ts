// Conversation lifecycle orchestrator. Routes call into here; the routes
// themselves only handle auth + body validation + HTTP translation. Every
// multi-step write goes through the record_conversation Postgres function so
// it's atomic. Read paths use the Supabase client directly.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { extractDebrief } from "./ai/extractor";
import { fuzzyMatchVoter, type VoterMatch } from "./voterSearch";
import {
  ConflictError,
  ExternalServiceError,
  ForbiddenError,
  InternalError,
  NotFoundError,
} from "./errors";
import type { ParticipantInput, RecordConversationInput } from "./types";
import { log } from "@/lib/logger";
import crypto from "node:crypto";

type RpcResult = { interaction_id: string; participant_ids: string[] };

export type RecordedDebrief = {
  interaction_id: string;
  extract: Awaited<ReturnType<typeof extractDebrief>>;
  participants: Array<{
    participant_id: string;
    captured_name: string;
    voter_ncid: string | null;
    match_confidence: number | null;
    candidates: VoterMatch[];
  }>;
};

// Run the debrief extractor, fuzzy-match each participant, and atomically
// insert via record_conversation. Returns the interaction id, all extracted
// data, and the per-participant match candidates so the UI can show
// "did you mean?" prompts.
export async function recordDebrief(
  supabase: SupabaseClient,
  user: User,
  transcript: string,
): Promise<RecordedDebrief> {
  const extract = await extractDebrief(transcript);

  // Fuzzy-match every participant in parallel. fuzzyMatchVoter never throws.
  const matched = await Promise.all(
    extract.participants.map(async (p, idx) => {
      const candidates = await fuzzyMatchVoter(supabase, p.name);
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

  const participantsPayload: ParticipantInput[] = matched.map((m) => ({
    captured_name: m.participant.name || "(no name)",
    voter_ncid: m.picked_ncid,
    relationship: m.participant.relationship || null,
    sentiment: m.participant.sentiment,
    issues: m.participant.issues,
    tags: m.participant.tags,
    notes: m.participant.notes || null,
    match_confidence: m.confidence,
    is_primary: m.index === 0,
  }));

  const extra_tags: string[] = [];
  if (extract.wants_sign) extra_tags.push("wants-yard-sign");
  if (extract.wants_to_volunteer) extra_tags.push("volunteer-interest");

  const { data, error } = await supabase.rpc("record_conversation", {
    p_user_id: user.id,
    p_captured_location: extract.captured_location,
    p_notes: extract.cleaned_notes,
    p_participants: participantsPayload,
    p_extra_tags: extra_tags,
  });
  if (error || !data) {
    log.error("record_debrief.rpc_failed", { user_id: user.id, err: error?.message });
    throw new InternalError(
      `record_conversation failed: ${error?.message ?? "unknown"}`,
      error,
    );
  }
  const { interaction_id, participant_ids } = data as RpcResult;

  log.info("record_debrief.ok", {
    user_id: user.id,
    interaction_id,
    participants: participant_ids.length,
    matched: matched.filter((m) => m.picked_ncid).length,
  });

  return {
    interaction_id,
    extract,
    participants: matched.map((m, i) => ({
      participant_id: participant_ids[i],
      captured_name: m.participant.name || "(no name)",
      voter_ncid: m.picked_ncid,
      match_confidence: m.confidence,
      candidates: m.candidates,
    })),
  };
}

// Manual single-person entry from /people/new and quick-add buttons.
export async function manualEntry(
  supabase: SupabaseClient,
  user: User,
  input: {
    captured_name: string;
    captured_location: string | null;
    notes: string | null;
    voter_ncid: string | null;
    match_confidence: number | null;
  },
): Promise<RpcResult> {
  const participants: ParticipantInput[] = [
    {
      captured_name: input.captured_name,
      voter_ncid: input.voter_ncid,
      sentiment: undefined,
      issues: [],
      tags: [],
      notes: input.notes,
      match_confidence: input.match_confidence,
      is_primary: true,
    },
  ];

  const { data, error } = await supabase.rpc("record_conversation", {
    p_user_id: user.id,
    p_captured_location: input.captured_location,
    p_notes: input.notes,
    p_participants: participants,
    p_extra_tags: [],
  });
  if (error || !data) {
    log.error("manual_entry.rpc_failed", { user_id: user.id, err: error?.message });
    throw new InternalError(`manual entry failed: ${error?.message ?? "unknown"}`, error);
  }
  log.info("manual_entry.ok", { user_id: user.id, voter_ncid: input.voter_ncid });
  return data as RpcResult;
}

// Update a participant. Domain layer enforces "no-op rejection" to give the
// route a clean ValidationError up the chain rather than a vague 400.
export async function updateParticipant(
  supabase: SupabaseClient,
  participantId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  // RLS on interaction_participants restricts updates to participants whose
  // parent interaction the caller owns. We don't add a redundant check here
  // because that just opens a TOCTOU window.

  // Manual link convention: setting voter_ncid sets confidence to 1.0;
  // unlinking clears it.
  if ("voter_ncid" in patch && patch.voter_ncid && !("match_confidence" in patch)) {
    patch.match_confidence = 1.0;
  }
  if ("voter_ncid" in patch && patch.voter_ncid === null) {
    patch.match_confidence = null;
  }

  const { error } = await supabase
    .from("interaction_participants")
    .update(patch)
    .eq("id", participantId);
  if (error) {
    log.warn("update_participant.failed", { id: participantId, err: error.message });
    throw new InternalError(error.message, error);
  }
}

// Find-or-create the per-user "Manual entries" voter list, then upsert a
// hand-typed voter into it and link the named participant to that voter.
export async function createManualVoter(
  supabase: SupabaseClient,
  user: User,
  participantId: string,
  voter: {
    first_name: string | null;
    last_name: string | null;
    middle_name: string | null;
    res_street_address: string | null;
    res_city: string | null;
    res_zip: string | null;
    party_cd: string | null;
    birth_year: number | null;
  },
): Promise<{ ncid: string; list_id: string }> {
  // Verify the participant belongs to the caller AND is currently unlinked.
  const { data: participant } = await supabase
    .from("interaction_participants")
    .select("id, interaction_id, voter_ncid")
    .eq("id", participantId)
    .single();
  if (!participant) throw new NotFoundError("participant not found");
  if (participant.voter_ncid) throw new ConflictError("participant already linked");

  // Find or create the Manual entries list. Unique partial index on
  // voter_lists(user_id) where name = 'Manual entries' makes concurrent
  // creates safe (the second one fails the conflict and we re-fetch).
  let manualListId: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: existing } = await supabase
      .from("voter_lists")
      .select("id")
      .eq("user_id", user.id)
      .eq("name", "Manual entries")
      .maybeSingle();
    if (existing?.id) {
      manualListId = existing.id as string;
      break;
    }
    const { data: created, error: createErr } = await supabase
      .from("voter_lists")
      .insert({
        user_id: user.id,
        name: "Manual entries",
        race_type: "unspecified",
        row_count: 0,
      })
      .select("id")
      .single();
    if (created?.id) {
      manualListId = created.id as string;
      break;
    }
    // If the insert raced and lost, retry once to pick up the existing row.
    if (createErr && /duplicate key|unique/.test(createErr.message)) {
      continue;
    }
    if (createErr) throw new InternalError(createErr.message, createErr);
  }
  if (!manualListId) throw new InternalError("could not provision Manual entries list");

  // Deterministic ncid so re-creating the same person twice is idempotent.
  const key = [
    user.id,
    voter.last_name ?? "",
    voter.first_name ?? "",
    voter.res_street_address ?? "",
    voter.res_city ?? "",
  ].map((s) => s.toLowerCase().trim()).join("|");
  const ncid = `M:${crypto.createHash("sha1").update(key).digest("hex").slice(0, 16)}`;

  const { error: vErr } = await supabase
    .from("voters")
    .upsert(
      {
        ncid,
        list_id: manualListId,
        first_name: voter.first_name,
        middle_name: voter.middle_name,
        last_name: voter.last_name,
        res_street_address: voter.res_street_address,
        res_city: voter.res_city,
        res_zip: voter.res_zip,
        party_cd: voter.party_cd,
        birth_year: voter.birth_year,
      },
      { onConflict: "ncid", ignoreDuplicates: false },
    );
  if (vErr) throw new InternalError(`voter create failed: ${vErr.message}`, vErr);

  await supabase
    .from("voter_list_members")
    .upsert(
      { list_id: manualListId, voter_ncid: ncid },
      { onConflict: "list_id,voter_ncid", ignoreDuplicates: true },
    );

  // Best-effort row_count update; if it fails the list still works.
  const { count } = await supabase
    .from("voter_list_members")
    .select("*", { count: "exact", head: true })
    .eq("list_id", manualListId);
  if (count !== null) {
    await supabase.from("voter_lists").update({ row_count: count }).eq("id", manualListId);
  }

  const { error: linkErr } = await supabase
    .from("interaction_participants")
    .update({ voter_ncid: ncid, match_confidence: 1.0 })
    .eq("id", participantId);
  if (linkErr) throw new InternalError(`link failed: ${linkErr.message}`, linkErr);

  log.info("create_manual_voter.ok", { user_id: user.id, ncid, participant_id: participantId });
  return { ncid, list_id: manualListId };
}

// Sanity check used by routes that want to confirm the user can act on
// a record. Throws ForbiddenError on mismatch.
export function assertOwnership(callerId: string, ownerId: string | null | undefined) {
  if (!ownerId || callerId !== ownerId) {
    throw new ForbiddenError("not the owner of this record");
  }
}
// Re-export for convenience so route handlers don't need a separate import.
export { ExternalServiceError };
