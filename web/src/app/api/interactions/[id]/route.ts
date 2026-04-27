import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

const ALLOWED = [
  "voter_ncid",
  "captured_name",
  "captured_location",
  "notes",
  "issues",
  "tags",
  "sentiment",
  "match_confidence",
] as const;

type Patch = Partial<Record<(typeof ALLOWED)[number], unknown>>;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as Record<string, unknown>;
  const patch: Patch = {};
  for (const k of ALLOWED) {
    if (k in body) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "no fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("interactions")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, interaction: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase.from("interactions").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
