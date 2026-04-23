import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const allowed = [
    "status",
    "asked_amount",
    "committed_amount",
    "donated_amount",
    "estimated_capacity",
    "next_step",
    "next_step_date",
    "notes",
    "email",
    "phone",
    "employer",
    "role",
  ] as const;
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in body) patch[k] = body[k];
  }

  const { data, error } = await supabase
    .from("fundraising_prospects")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, prospect: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { error } = await supabase.from("fundraising_prospects").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
