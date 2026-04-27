import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { parseUploadedFile } from "@/lib/ingest/parse";
import { mapColumns, type ColumnMap } from "@/lib/ingest/mapColumns";

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
  const name = (form.get("name") as string | null)?.trim() || "Untitled list";
  const state = (form.get("state") as string | null)?.trim() || null;
  if (!file) return Response.json({ error: "no file" }, { status: 400 });
  if (file.size > 5 * 1024 * 1024)
    return Response.json({ error: "file too large (max 5 MB)" }, { status: 413 });

  const buffer = await file.arrayBuffer();

  // 1. Parse the file
  let parsed;
  try {
    parsed = await parseUploadedFile(file.name, buffer);
  } catch (e) {
    return Response.json({ error: `parse failed: ${(e as Error).message}` }, { status: 400 });
  }
  if (parsed.rows.length === 0) {
    return Response.json({ error: "file has no data rows" }, { status: 400 });
  }

  // 2. Ask Claude to map columns
  let mapping: ColumnMap;
  try {
    mapping = await mapColumns(parsed.headers, parsed.sampleRows);
  } catch (e) {
    return Response.json({ error: `column mapping failed: ${(e as Error).message}` }, { status: 502 });
  }

  // 3. Create the voter_list row
  const { data: listRow, error: listErr } = await supabase
    .from("voter_lists")
    .insert({
      user_id: user.id,
      name,
      state,
      source_filename: file.name,
      row_count: parsed.rows.length,
    })
    .select("id")
    .single();
  if (listErr || !listRow) {
    return Response.json({ error: listErr?.message ?? "list create failed" }, { status: 500 });
  }
  const listId = listRow.id as string;

  // 4. Transform rows. Voters are deduped by ncid globally — uploading the
  //    same person to a second list reuses the existing voter row but creates
  //    a new (list, voter) membership.
  const voterRows = parsed.rows.map((r, idx) => rowToVoter(r, mapping, listId, idx));
  const CHUNK = 500;
  let votersAdded = 0;
  let membersAdded = 0;
  for (let i = 0; i < voterRows.length; i += CHUNK) {
    const chunk = voterRows.slice(i, i + CHUNK);

    // Insert new voter rows; ignore conflicts on existing ncids.
    // Supabase's upsert with onConflict + ignoreDuplicates does this.
    const { error: voterErr } = await supabase
      .from("voters")
      .upsert(chunk, { onConflict: "ncid", ignoreDuplicates: true });
    if (voterErr) {
      await supabase.from("voter_lists").delete().eq("id", listId);
      return Response.json({
        error: `voter insert failed after ${votersAdded} rows: ${voterErr.message}`,
        sample_row: chunk[0],
      }, { status: 500 });
    }
    votersAdded += chunk.length;

    // Insert membership rows for every voter in this chunk.
    const memberRows = chunk.map((v) => ({ list_id: listId, voter_ncid: v.ncid }));
    const { error: memberErr } = await supabase
      .from("voter_list_members")
      .upsert(memberRows, { onConflict: "list_id,voter_ncid", ignoreDuplicates: true });
    if (memberErr) {
      await supabase.from("voter_lists").delete().eq("id", listId);
      return Response.json({
        error: `membership insert failed after ${membersAdded} rows: ${memberErr.message}`,
      }, { status: 500 });
    }
    membersAdded += memberRows.length;
  }

  return Response.json({
    ok: true,
    list_id: listId,
    rows: membersAdded,
    voters_added: votersAdded,
    mapping,
    sample_before: parsed.sampleRows[0] ?? null,
    sample_after: voterRows[0] ?? null,
  });
}

function rowToVoter(
  source: Record<string, string>,
  m: ColumnMap,
  listId: string,
  idx: number,
) {
  const pick = (field: keyof ColumnMap) => {
    const col = m[field];
    if (!col) return null;
    const v = source[col]?.trim();
    return v && v.length > 0 ? v : null;
  };

  // Address: prefer single column, else concat street_number + street_name.
  let address = pick("res_street_address");
  if (!address) {
    const n = pick("street_number");
    const s = pick("street_name");
    if (n && s) address = `${n} ${s}`;
    else if (s) address = s;
  }

  // Registration date: try ISO, MM/DD/YYYY, M/D/YY.
  const registrIso = normalizeDate(pick("registr_dt"));

  // Numeric fields
  const byRaw = pick("birth_year");
  const birth_year = byRaw && /^\d{4}$/.test(byRaw) ? parseInt(byRaw, 10) : null;
  const ageRaw = pick("age");
  const age = ageRaw && /^\d{1,3}$/.test(ageRaw) ? parseInt(ageRaw, 10) : null;

  // ncid: use provided, else synthesize from list+index
  const ncid = pick("ncid") ?? `${listId.slice(0, 8)}-${idx + 1}`;

  return {
    ncid,
    list_id: listId,
    voter_reg_num: pick("ncid"),
    first_name: pick("first_name"),
    middle_name: pick("middle_name"),
    last_name: pick("last_name"),
    name_suffix: pick("name_suffix"),
    res_street_address: address,
    res_city: pick("res_city"),
    res_zip: pick("res_zip"),
    party_cd: pick("party_cd"),
    gender_code: pick("gender_code"),
    race_code: pick("race_code"),
    birth_year,
    age,
    registr_dt: registrIso,
    precinct_desc: pick("precinct_desc"),
    ward_desc: pick("ward_desc"),
    municipality_desc: pick("municipality_desc"),
  };
}

function normalizeDate(s: string | null): string | null {
  if (!s) return null;
  // ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // MM/DD/YYYY or M/D/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const yy = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    const iso = `${yy}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    return iso;
  }
  return null;
}
