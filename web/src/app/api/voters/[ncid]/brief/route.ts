import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { generateBrief } from "@/lib/ai/voterAI";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ ncid: string }> },
) {
  const { ncid } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const [{ data: candidate }, { data: profile }, { data: rawParts }] = await Promise.all([
    supabase.from("candidates").select("candidate_name, office, jurisdiction").eq("user_id", user.id).maybeSingle(),
    supabase.rpc("get_voter_profile", { p_ncid: ncid }),
    // Per-person sentiment/issues/tags live on participants. Join to the
    // parent interaction for created_at + location + cleaned notes.
    supabase.from("interaction_participants")
      .select("sentiment, issues, tags, notes, interactions(created_at, captured_location, notes)")
      .eq("voter_ncid", ncid)
      .limit(20),
  ]);
  if (!candidate || !profile) {
    return Response.json({ error: "missing candidate profile or voter" }, { status: 400 });
  }

  type Inter = { created_at: string; captured_location: string | null; notes: string | null };
  type PartRow = {
    sentiment: string | null;
    issues: string[] | null;
    tags: string[] | null;
    notes: string | null;
    // Supabase typegen returns the join as an array even for single-row joins.
    interactions: Inter | Inter[] | null;
  };
  const oneInter = (i: Inter | Inter[] | null): Inter | null =>
    Array.isArray(i) ? i[0] ?? null : i;
  const parts = (rawParts ?? []) as unknown as PartRow[];
  const interactions = parts
    .map((p) => {
      const inter = oneInter(p.interactions);
      return {
        created_at: inter?.created_at ?? "",
        captured_location: inter?.captured_location ?? null,
        notes: p.notes ?? inter?.notes ?? null,
        sentiment: p.sentiment,
        issues: p.issues,
        tags: p.tags,
      };
    })
    .filter((r) => r.created_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 10);

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
    const brief = await generateBrief({
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
    return Response.json({ ok: true, brief });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
