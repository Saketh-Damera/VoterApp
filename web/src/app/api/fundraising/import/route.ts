import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { parseUploadedFile } from "@/lib/ingest/parse";
import { mapDonorColumns, type DonorColumnMap } from "@/lib/ingest/mapDonorColumns";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "could not read upload" }, { status: 400 });
  }
  const file = form.get("file") as File | null;
  if (!file) return Response.json({ error: "no file" }, { status: 400 });
  if (file.size > 5 * 1024 * 1024)
    return Response.json({ error: "file too large (max 5 MB)" }, { status: 413 });

  const buffer = await file.arrayBuffer();

  let parsed;
  try {
    parsed = await parseUploadedFile(file.name, buffer);
  } catch (e) {
    return Response.json({ error: `parse failed: ${(e as Error).message}` }, { status: 400 });
  }
  if (parsed.rows.length === 0) {
    return Response.json({ error: "file has no data rows" }, { status: 400 });
  }

  let mapping: DonorColumnMap;
  try {
    mapping = await mapDonorColumns(parsed.headers, parsed.sampleRows);
  } catch (e) {
    return Response.json({ error: `column mapping failed: ${(e as Error).message}` }, { status: 502 });
  }

  const rows = parsed.rows
    .map((r) => rowToProspect(r, mapping, user.id))
    .filter((r): r is NonNullable<ReturnType<typeof rowToProspect>> => !!r);

  if (rows.length === 0) {
    return Response.json({
      error: "Couldn't derive any donor rows from that file. Did the file have a name column?",
      mapping,
    }, { status: 400 });
  }

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("fundraising_prospects").insert(chunk);
    if (error) {
      return Response.json({
        error: `insert failed after ${inserted} rows: ${error.message}`,
        sample_row: chunk[0],
      }, { status: 500 });
    }
    inserted += chunk.length;
  }

  return Response.json({ ok: true, inserted, mapping });
}

function rowToProspect(
  source: Record<string, string>,
  m: DonorColumnMap,
  userId: string,
) {
  const pick = (field: keyof DonorColumnMap) => {
    const col = m[field];
    if (!col) return null;
    const v = source[col]?.trim();
    return v && v.length > 0 ? v : null;
  };

  // Name: prefer full_name, else combine first + last.
  let fullName = pick("full_name");
  if (!fullName) {
    const first = pick("first_name");
    const last = pick("last_name");
    fullName = [first, last].filter(Boolean).join(" ") || null;
  }
  if (!fullName) return null;

  const capRaw = pick("estimated_capacity");
  // Strip $ and commas, leave digits + decimal
  const capNum = capRaw ? parseFloat(capRaw.replace(/[^0-9.\-]/g, "")) : NaN;

  return {
    user_id: userId,
    full_name: fullName,
    email: pick("email"),
    phone: pick("phone"),
    employer: pick("employer"),
    role: pick("role"),
    estimated_capacity: Number.isFinite(capNum) ? capNum : null,
    notes: pick("notes"),
    status: "prospect" as const,
  };
}
