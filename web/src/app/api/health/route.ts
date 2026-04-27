import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Reports which env vars are configured. Never returns key values.
// Auth-gated so anonymous probes can't enumerate config.
export async function GET(_req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  return Response.json({
    ok: true,
    env: {
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      JED_MODEL: process.env.JED_MODEL ?? "claude-haiku-4-5 (default)",
      JED_MODEL_CHEAP: process.env.JED_MODEL_CHEAP ?? "(unset, falls back to JED_MODEL)",
    },
    runtime: {
      node_env: process.env.NODE_ENV,
      vercel_env: process.env.VERCEL_ENV ?? "(local)",
      vercel_region: process.env.VERCEL_REGION ?? "(local)",
    },
  });
}
