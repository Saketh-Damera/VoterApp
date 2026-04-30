// Domain DTOs validated by Zod. Single source of truth for what's allowed
// to cross a route boundary. Use these in route handlers via .safeParse()
// and translate parse errors into ValidationError.

import { z } from "zod";

export const SentimentEnum = z.enum([
  "supportive",
  "leaning_supportive",
  "undecided",
  "leaning_opposed",
  "opposed",
  "unknown",
]);
export type Sentiment = z.infer<typeof SentimentEnum>;

export const RaceTypeEnum = z.enum([
  "primary_dem",
  "primary_rep",
  "primary_any",
  "general",
  "municipal",
  "special",
  "unspecified",
]);
export type RaceType = z.infer<typeof RaceTypeEnum>;

// ---- Conversation flow ----

export const ParticipantInputSchema = z.object({
  captured_name: z.string().min(1).max(200),
  voter_ncid: z.string().max(200).nullable().optional(),
  relationship: z.string().max(80).nullable().optional(),
  sentiment: SentimentEnum.optional(),
  issues: z.array(z.string().min(1).max(60)).max(20).default([]),
  tags: z.array(z.string().min(1).max(60)).max(20).default([]),
  notes: z.string().max(4000).nullable().optional(),
  match_confidence: z.number().min(0).max(1).nullable().optional(),
  is_primary: z.boolean().optional(),
});
export type ParticipantInput = z.infer<typeof ParticipantInputSchema>;

export const RecordConversationInputSchema = z.object({
  captured_location: z.string().max(200).nullable().optional(),
  notes: z.string().max(20000).nullable().optional(),
  participants: z.array(ParticipantInputSchema).min(1).max(20),
  extra_tags: z.array(z.string().max(60)).max(10).default([]),
});
export type RecordConversationInput = z.infer<typeof RecordConversationInputSchema>;

export const DebriefRequestSchema = z.object({
  transcript: z.string().min(10).max(60_000),
});

export const ManualEntryRequestSchema = z.object({
  captured_name: z.string().min(1).max(200),
  captured_location: z.string().max(200).nullable().optional(),
  notes: z.string().max(20000).nullable().optional(),
  voter_ncid: z.string().max(200).nullable().optional(),
  match_confidence: z.number().min(0).max(1).nullable().optional(),
});

// ---- Participant patches ----

export const ParticipantPatchSchema = z.object({
  voter_ncid: z.string().max(200).nullable().optional(),
  sentiment: SentimentEnum.nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  issues: z.array(z.string().max(60)).max(20).optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
  captured_name: z.string().min(1).max(200).optional(),
  relationship: z.string().max(80).nullable().optional(),
  match_confidence: z.number().min(0).max(1).nullable().optional(),
}).refine((p) => Object.keys(p).length > 0, {
  message: "patch must contain at least one field",
});

export const CreateManualVoterSchema = z.object({
  first_name: z.string().min(1).max(80).nullable().optional(),
  last_name: z.string().min(1).max(80).nullable().optional(),
  middle_name: z.string().max(80).nullable().optional(),
  res_street_address: z.string().max(200).nullable().optional(),
  res_city: z.string().max(100).nullable().optional(),
  res_zip: z.string().max(20).nullable().optional(),
  party_cd: z.string().max(20).nullable().optional(),
  birth_year: z.number().int().min(1900).max(2100).nullable().optional(),
}).refine(
  (v) => (v.first_name?.trim() || v.last_name?.trim()),
  { message: "first_name or last_name required", path: ["last_name"] },
);

// ---- AskJED ----

export const AskJedRequestSchema = z.object({
  question: z.string().min(1).max(2000),
});

// ---- Generic helpers ----
// parseOrThrow lives in the route layer (where it can throw ValidationError
// from ./errors without creating a cycle). Domain code uses zod directly via
// safeParse + Result.
