import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const voter_ncid = (body.voter_ncid as string | undefined)?.trim();
  if (!voter_ncid) return Response.json({ error: "voter_ncid required" }, { status: 400 });

  const { error } = await supabase
    .from("event_attendees")
    .insert({ event_id: eventId, voter_ncid, note: body.note ?? null });
  if (error && !error.message.includes("duplicate")) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const ncid = url.searchParams.get("voter_ncid");
  if (!ncid) return Response.json({ error: "voter_ncid required" }, { status: 400 });

  const { error } = await supabase
    .from("event_attendees")
    .delete()
    .eq("event_id", eventId)
    .eq("voter_ncid", ncid);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
