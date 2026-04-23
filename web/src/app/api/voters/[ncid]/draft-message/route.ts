import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { draftFollowUp } from "@/lib/ai/voterAI";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ ncid: string }> },
) {
  const { ncid } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const [{ data: candidate }, { data: profile }, { data: interactions }] = await Promise.all([
    supabase.from("candidates").select("candidate_name, office, jurisdiction").eq("user_id", user.id).maybeSingle(),
    supabase.rpc("get_voter_profile", { p_ncid: ncid }),
    supabase.from("interactions")
      .select("created_at, captured_location, notes, sentiment, issues, tags")
      .eq("voter_ncid", ncid)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  if (!candidate || !profile) {
    return Response.json({ error: "missing candidate profile or voter" }, { status: 400 });
  }

  type Profile = {
    voter: {
      first_name: string | null; last_name: string | null; age: number | null;
      party_cd: string | null; res_street_address: string | null; res_city: string | null;
      precinct_desc: string | null;
    };
    turnout: { elections_voted: number; generals_voted: number; last_voted: string | null } | null;
    household: Array<{ first_name: string | null; last_name: string | null; age: number | null; party_cd: string | null }>;
  };
  const p = profile as Profile;

  try {
    const draft = await draftFollowUp({
      candidate: {
        name: candidate.candidate_name,
        office: candidate.office,
        jurisdiction: candidate.jurisdiction,
      },
      voter: p.voter,
      turnout: p.turnout,
      household: p.household ?? [],
      interactions: interactions ?? [],
    });
    return Response.json({ ok: true, draft });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
