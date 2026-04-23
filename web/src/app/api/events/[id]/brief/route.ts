import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { generateEventBrief } from "@/lib/ai/eventBrief";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const [{ data: candidate }, { data: ev }, { data: attendees }] = await Promise.all([
    supabase.from("candidates").select("candidate_name, office, jurisdiction").eq("user_id", user.id).maybeSingle(),
    supabase.from("events").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("event_attendees")
      .select("voter_ncid, voters(first_name, last_name, res_city, party_cd)")
      .eq("event_id", id),
  ]);
  if (!candidate || !ev) {
    return Response.json({ error: "event or candidate missing" }, { status: 400 });
  }

  type Row = {
    voter_ncid: string;
    voters: { first_name: string | null; last_name: string | null; res_city: string | null; party_cd: string | null } | null;
  };
  const rows = (attendees as Row[] | null) ?? [];
  if (rows.length === 0) {
    return Response.json({ error: "no attendees added yet" }, { status: 400 });
  }

  // Pull latest interaction per attendee so the brief can reference specifics
  const ncids = rows.map((r) => r.voter_ncid);
  const { data: latest } = await supabase
    .from("interactions")
    .select("voter_ncid, sentiment, issues, tags, notes, created_at")
    .in("voter_ncid", ncids)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  type I = {
    voter_ncid: string;
    sentiment: string | null;
    issues: string[] | null;
    tags: string[] | null;
    notes: string | null;
    created_at: string;
  };
  const latestByNcid = new Map<string, I>();
  for (const i of (latest as I[] | null) ?? []) {
    if (!latestByNcid.has(i.voter_ncid)) latestByNcid.set(i.voter_ncid, i);
  }

  const attendeeCtx = rows.map((r) => {
    const i = latestByNcid.get(r.voter_ncid);
    return {
      name: [r.voters?.first_name, r.voters?.last_name].filter(Boolean).join(" ") || "(unknown)",
      city: r.voters?.res_city ?? null,
      party: r.voters?.party_cd ?? null,
      last_sentiment: i?.sentiment ?? null,
      issues: i?.issues ?? [],
      tags: i?.tags ?? [],
      recent_note: i?.notes ?? null,
    };
  });

  try {
    const brief = await generateEventBrief({
      candidate: {
        name: candidate.candidate_name,
        office: candidate.office,
        jurisdiction: candidate.jurisdiction,
      },
      event: {
        title: ev.title,
        location: ev.location,
        event_date: ev.event_date,
        notes: ev.notes,
      },
      attendees: attendeeCtx,
    });

    // Cache it
    await supabase
      .from("events")
      .update({ brief: JSON.stringify(brief), brief_generated_at: new Date().toISOString() })
      .eq("id", id);

    return Response.json({ ok: true, brief });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
