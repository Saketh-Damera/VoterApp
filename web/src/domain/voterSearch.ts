// Voter lookup against the candidate's lists. Wraps the match_voters and
// find_voters_by_name RPCs and provides a stable typed interface for the
// rest of the domain layer.

import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/logger";

export type VoterMatch = {
  ncid: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  res_street_address: string | null;
  res_city: string | null;
  party_cd: string | null;
  birth_year: number | null;
  confidence: number;
};

export type FindHit = {
  ncid: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  res_street_address: string | null;
  res_city: string | null;
  party_cd: string | null;
  birth_year: number | null;
  match_count: number;
};

// Single-name fuzzy match (used by debrief participant matching).
export async function fuzzyMatchVoter(
  supabase: SupabaseClient,
  name: string,
  maxResults = 5,
): Promise<VoterMatch[]> {
  if (!name || name.trim().length < 3) return [];
  const { data, error } = await supabase.rpc("match_voters", {
    q: name.trim(),
    max_results: maxResults,
  });
  if (error) {
    log.warn("voter_search.match_voters.failed", { name, err: error.message });
    return [];
  }
  return (data as VoterMatch[] | null) ?? [];
}

// Token-based fuzzy match for free-form questions ("the smiths in tenafly").
// Returns at most maxResults voters. Empty array on no signal — never throws.
export async function searchByQuestion(
  supabase: SupabaseClient,
  question: string,
  maxResults = 30,
): Promise<FindHit[]> {
  if (!question || question.trim().length < 2) return [];
  const { data, error } = await supabase.rpc("find_voters_by_name", {
    q: question,
    max_results: maxResults,
  });
  if (error) {
    log.warn("voter_search.find_voters_by_name.failed", { err: error.message });
    return [];
  }
  return (data as FindHit[] | null) ?? [];
}

// Heuristic gate so we don't run a full table scan on questions that aren't
// looking up a person ("what issues come up most often?").
const SKIP_TOKENS = new Set([
  "the","and","any","all","show","list","find","tell","give","for","from","with",
  "about","who","what","where","when","how","why","this","that","these","those",
  "they","them","their","his","her","our","your","you","have","has","had","was",
  "were","are","can","could","would","should","will","want","need","please",
  "thanks","really","also","jed","voter","voters","people","person","family",
  "households","household","members","member","name","names","last","first",
  "file","files","match","matches","one","two","three","many","much","some",
  "few","look","search","pull","present","option","options","direct","ones",
  "say","said","wanted","recall","same","just","only","already","still","again",
  "help","supporter","supporters","undecided","leaning","opposed","supportive",
  "neutral","ward","precinct","district","week","month","year","today",
  "yesterday","tomorrow","date","day","does","did","done","yes","no","then",
  "than","but","because","most","more","less","fewer","talk","talks","talked",
  "spoke","spoken","conversation","conversations","issue","issues","topic",
  "topics","trend","trends","summary","summarize","come","comes","came","up",
  "down","into","out","off","over","under","along",
]);
export function questionLikelyMentionsName(q: string): boolean {
  const tokens = q.split(/[^a-zA-Z]+/).filter(Boolean);
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (SKIP_TOKENS.has(lower)) continue;
    if (t.length >= 3 && /^[A-Z]/.test(t)) return true;
    if (lower.length >= 5) return true;
  }
  return false;
}
