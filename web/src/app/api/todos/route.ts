import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const title = (body.title as string | undefined)?.trim();
  if (!title) return Response.json({ error: "title required" }, { status: 400 });

  const { data, error } = await supabase
    .from("todos")
    .insert({
      user_id: user.id,
      title,
      notes: body.notes ?? null,
      due_date: body.due_date ?? null,
    })
    .select("*")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, todo: data });
}
