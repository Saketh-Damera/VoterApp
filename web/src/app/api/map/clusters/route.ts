import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const eps = Math.max(30, Math.min(parseFloat(url.searchParams.get("eps") ?? "150"), 2000));

  const { data, error } = await supabase.rpc("geo_clusters", {
    p_eps_meters: eps,
    p_min_pts: 2,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ clusters: data ?? [] });
}
