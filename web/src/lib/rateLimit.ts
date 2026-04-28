import type { SupabaseClient } from "@supabase/supabase-js";

// Per-user, per-route rate limit backed by the request_log table.
// Best-effort and idempotent: an insert failure does not block the request,
// it just means we did not record this attempt for the next caller.
export type RateLimitResult =
  | { ok: true }
  | { ok: false; message: string; retryAfter: number };

export async function checkRateLimit(
  supabase: SupabaseClient,
  userId: string,
  route: string,
  maxPerWindow: number,
  windowMinutes: number,
): Promise<RateLimitResult> {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const { count, error: countErr } = await supabase
    .from("request_log")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("route", route)
    .gte("created_at", since);
  if (countErr) {
    // Fail open — the limiter must not deny service if the table is missing
    // or the count query errors.
    return { ok: true };
  }
  if (count !== null && count >= maxPerWindow) {
    return {
      ok: false,
      message: `${maxPerWindow} ${route} requests per ${windowMinutes} min — try again later`,
      retryAfter: windowMinutes * 60,
    };
  }
  // Record this request. RLS allows insert if user_id = auth.uid().
  await supabase.from("request_log").insert({ user_id: userId, route });
  return { ok: true };
}
