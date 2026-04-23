import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const full_name = (body.full_name as string | undefined)?.trim();
  if (!full_name) return Response.json({ error: "full_name required" }, { status: 400 });

  const { data, error } = await supabase
    .from("fundraising_prospects")
    .insert({
      user_id: user.id,
      full_name,
      email: body.email ?? null,
      phone: body.phone ?? null,
      employer: body.employer ?? null,
      role: body.role ?? null,
      estimated_capacity: body.estimated_capacity ?? null,
      notes: body.notes ?? null,
      next_step: body.next_step ?? null,
      next_step_date: body.next_step_date ?? null,
      status: body.status ?? "prospect",
    })
    .select("*")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, prospect: data });
}
