import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { draftAsk } from "@/lib/ai/voterAI";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const [{ data: candidate }, { data: prospect }] = await Promise.all([
    supabase.from("candidates").select("candidate_name, office, jurisdiction").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("fundraising_prospects")
      .select("full_name, employer, role, estimated_capacity, notes, status")
      .eq("id", id)
      .maybeSingle(),
  ]);
  if (!candidate || !prospect) {
    return Response.json({ error: "missing candidate or prospect" }, { status: 400 });
  }

  try {
    const draft = await draftAsk({
      candidate: {
        name: candidate.candidate_name,
        office: candidate.office,
        jurisdiction: candidate.jurisdiction,
      },
      prospect,
    });
    return Response.json({ ok: true, draft });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
