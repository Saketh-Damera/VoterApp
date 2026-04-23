import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ ncid: string }> },
) {
  const { ncid } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  // Get voter name to pre-fill the prospect
  const { data: voter } = await supabase
    .from("voters")
    .select("first_name, last_name")
    .eq("ncid", ncid)
    .maybeSingle();
  if (!voter) return Response.json({ error: "voter not found" }, { status: 404 });

  const fullName = [voter.first_name, voter.last_name].filter(Boolean).join(" ") || "(unnamed)";

  const { data, error } = await supabase
    .from("fundraising_prospects")
    .insert({
      user_id: user.id,
      voter_ncid: ncid,
      full_name: fullName,
      status: "prospect",
    })
    .select("id")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, prospect_id: data.id });
}
