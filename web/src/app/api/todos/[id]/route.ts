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
  const patch: Record<string, string | null | Date> = {};
  if (body.status === "done") {
    patch.status = "done";
    patch.completed_at = new Date();
  } else if (body.status === "pending") {
    patch.status = "pending";
    patch.completed_at = null;
  }
  if (typeof body.title === "string") patch.title = body.title;
  if ("notes" in body) patch.notes = body.notes ?? null;
  if ("due_date" in body) patch.due_date = body.due_date ?? null;

  const { data, error } = await supabase
    .from("todos")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, todo: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase.from("todos").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
