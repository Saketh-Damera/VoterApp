import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const miles = Math.min(Number(body.miles ?? 0.25), 10);
  if (!isFinite(lat) || !isFinite(lng) || !isFinite(miles) || miles <= 0) {
    return Response.json({ error: "invalid coords/miles" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("voters_within_radius", {
    p_lat: lat,
    p_lng: lng,
    p_miles: miles,
    p_party: body.party ?? null,
    p_contacted_only: !!body.contacted_only,
    p_limit: 500,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ voters: data ?? [] });
}
