import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";
import { parseUploadedFile } from "@/lib/ingest/parse";
import { mapColumns, type ColumnMap } from "@/lib/ingest/mapColumns";
import { splitFullName, normalizeDate, stableNcid } from "@/domain/ingest/normalize";

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
  const state = (form.get("state") as string | null)?.trim().toUpperCase() || null;
  const city = (form.get("city") as string | null)?.trim() || null;
  const RACE_TYPES = new Set([
    "primary_dem", "primary_rep", "primary_any",
    "general", "municipal", "special", "unspecified",
  ]);
  const raceTypeRaw = (form.get("race_type") as string | null)?.trim() || null;
  const race_type = raceTypeRaw && RACE_TYPES.has(raceTypeRaw) ? raceTypeRaw : null;
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
      city,
      race_type,
      source_filename: file.name,
      row_count: parsed.rows.length,
    })
    .select("id")
    .single();
  if (listErr || !listRow) {
    return Response.json({ error: listErr?.message ?? "list create failed" }, { status: 500 });
  }
  const listId = listRow.id as string;

  // 4. Transform rows. Voters dedupe by ncid; uploading the same person to a
  //    second list reuses the existing voter row but adds a new membership.
  const mappedSourceCols = new Set(Object.values(mapping).filter((v) => v));
  const voterRows = parsed.rows.map((r, idx) =>
    rowToVoter(r, mapping, parsed.headers, mappedSourceCols, listId, idx, state),
  );

  const CHUNK = 500;
  let votersAdded = 0;
  let membersAdded = 0;
  for (let i = 0; i < voterRows.length; i += CHUNK) {
    const chunk = voterRows.slice(i, i + CHUNK);

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
  allHeaders: string[],
  mappedCols: Set<string>,
  listId: string,
  idx: number,
  state: string | null,
) {
  const pick = (field: keyof ColumnMap) => {
    const col = m[field];
    if (!col) return null;
    const v = source[col]?.trim();
    return v && v.length > 0 ? v : null;
  };

  // Names: prefer split columns, fall back to splitting full_name
  let first_name = pick("first_name");
  let middle_name = pick("middle_name");
  let last_name = pick("last_name");
  let suffix = pick("name_suffix");
  if (!first_name && !last_name) {
    const full = pick("full_name");
    if (full) {
      const parts = splitFullName(full);
      first_name = parts.first;
      middle_name = middle_name ?? parts.middle;
      last_name = parts.last;
      suffix = suffix ?? parts.suffix;
    }
  }

  // Address: prefer single column, else concat number + name; always append unit
  let address = pick("res_street_address");
  if (!address) {
    const n = pick("street_number");
    const s = pick("street_name");
    if (n && s) address = `${n} ${s}`;
    else if (s) address = s;
    else if (n) address = n;
  }
  const unit = pick("street_unit");
  if (address && unit && !address.toLowerCase().includes(unit.toLowerCase())) {
    address = `${address} ${unit}`;
  } else if (!address && unit) {
    address = unit;
  }

  const registrIso = normalizeDate(pick("registr_dt"));

  const byRaw = pick("birth_year");
  const birth_year = byRaw && /^\d{4}$/.test(byRaw) ? parseInt(byRaw, 10) : null;
  const ageRaw = pick("age");
  const age = ageRaw && /^\d{1,3}$/.test(ageRaw) ? parseInt(ageRaw, 10) : null;

  const ncid = stableNcid({
    rawId: pick("ncid"),
    state,
    first: first_name,
    last: last_name,
    address,
    city: pick("res_city"),
    listId,
    idx,
  });

  const extra: Record<string, string> = {};
  for (const h of allHeaders) {
    if (mappedCols.has(h)) continue;
    const v = source[h]?.trim();
    if (v) extra[h] = v;
  }

  // Phone numbers: digit-normalize but keep formatting if it includes letters
  const normalizePhone = (raw: string | null) => {
    if (!raw) return null;
    const digits = raw.replace(/[^\d]/g, "");
    if (digits.length === 10) return digits;
    if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
    return raw.trim();
  };

  // Email: lowercase normalized
  const normalizeEmail = (raw: string | null) => raw ? raw.trim().toLowerCase() : null;

  // Mailing address concat (optional)
  const mailing = pick("mailing_address");
  const mailing_address = mailing;

  return {
    ncid,
    list_id: listId,
    voter_reg_num: pick("ncid"),
    first_name,
    middle_name,
    last_name,
    name_suffix: suffix,
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

    // New comprehensive contact + civic fields
    phone:           normalizePhone(pick("phone")),
    phone_secondary: normalizePhone(pick("phone_secondary")),
    email:           normalizeEmail(pick("email")),
    email_secondary: normalizeEmail(pick("email_secondary")),
    website:         pick("website"),
    occupation:      pick("occupation"),
    employer:        pick("employer"),
    household_id:    pick("household_id"),
    mailing_address,
    mailing_city:    pick("mailing_city"),
    mailing_state:   pick("mailing_state"),
    mailing_zip:     pick("mailing_zip"),
    voter_status:    pick("voter_status"),
    voter_status_reason: pick("voter_status_reason"),
    congressional_district: pick("congressional_district"),
    state_house_district:   pick("state_house_district"),
    state_senate_district:  pick("state_senate_district"),
    school_district: pick("school_district"),
    last_updated_in_source: normalizeDate(pick("last_updated_in_source")),
    language_preference: pick("language_preference"),

    extra: Object.keys(extra).length ? extra : null,
  };
}

// splitFullName, normalizeDate, stableNcid moved to @/domain/ingest/normalize
// so they are testable without Next imports.
