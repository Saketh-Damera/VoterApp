import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";

export const runtime = "nodejs";

// POST /api/geocode/contacted — geocodes up to N contacted voters who don't
// have lat/lng yet. Safe to hit repeatedly; skips already-geocoded rows.
export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "25", 10), 50);

  const { data: toGeocode } = await supabase
    .from("interaction_participants")
    .select(
      "voter_ncid, interactions!inner(user_id), " +
        "voters!inner(ncid, res_street_address, res_city, res_zip, lat)",
    )
    .eq("interactions.user_id", user.id)
    .not("voter_ncid", "is", null)
    .limit(200);

  type Row = {
    voter_ncid: string;
    voters: {
      ncid: string;
      res_street_address: string | null;
      res_city: string | null;
      res_zip: string | null;
      lat: number | null;
    };
  };

  const rows = (toGeocode as Row[] | null) ?? [];
  // Dedupe voters without coords
  const pending = new Map<string, Row["voters"]>();
  for (const r of rows) {
    if (!r.voters?.lat && r.voters?.res_street_address) {
      pending.set(r.voters.ncid, r.voters);
    }
  }
  const targets = Array.from(pending.values()).slice(0, limit);

  let ok = 0;
  let fail = 0;
  for (const v of targets) {
    const hit = await geocodeAddress(
      v.res_street_address ?? "",
      v.res_city,
      "NC", // default; we'll make per-state later with list.state
      v.res_zip,
    );
    if (hit) {
      await supabase
        .from("voters")
        .update({ lat: hit.lat, lng: hit.lng, geocoded_at: new Date().toISOString() })
        .eq("ncid", v.ncid);
      ok++;
    } else {
      fail++;
    }
    // polite pause
    await new Promise((r) => setTimeout(r, 250));
  }

  return Response.json({
    ok: true,
    attempted: targets.length,
    geocoded: ok,
    failed: fail,
    remaining_after: pending.size - targets.length,
  });
}
