import ExcelJS from "exceljs";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  captured_name: string;
  voter_ncid: string | null;
  sentiment: string | null;
  issues: string[] | null;
  tags: string[] | null;
  notes: string | null;
  relationship: string | null;
  is_primary: boolean;
  interactions: {
    created_at: string;
    captured_location: string | null;
    notes: string | null;
  } | null;
  voters: {
    first_name: string | null;
    last_name: string | null;
    res_street_address: string | null;
    res_city: string | null;
    res_zip: string | null;
    party_cd: string | null;
    birth_year: number | null;
    precinct_desc: string | null;
  } | null;
};

type ColumnDef = {
  key: string;
  header: string;
  width: number;
  // Returns the cell value for a given interaction row.
  // Date for date cells, string otherwise.
  value: (r: Row, missing: string) => string | Date;
};

const ALL_COLUMNS: ColumnDef[] = [
  { key: "date",      header: "Date",          width: 18, value: (r) => r.interactions?.created_at ? new Date(r.interactions.created_at) : "" },
  { key: "first",     header: "First name",    width: 16, value: (r, m) => r.voters?.first_name ?? m },
  { key: "last",      header: "Last name",     width: 18, value: (r, m) => r.voters?.last_name ?? m },
  { key: "address",   header: "Address",       width: 32, value: (r, m) => r.voters?.res_street_address ?? m },
  { key: "city",      header: "City",          width: 14, value: (r, m) => r.voters?.res_city ?? m },
  { key: "zip",       header: "ZIP",           width: 10, value: (r, m) => r.voters?.res_zip ?? m },
  { key: "party",     header: "Party",         width: 8,  value: (r, m) => r.voters?.party_cd ?? m },
  { key: "byear",     header: "Birth year",    width: 10, value: (r, m) => r.voters?.birth_year != null ? String(r.voters.birth_year) : m },
  { key: "precinct",  header: "Precinct",      width: 16, value: (r, m) => r.voters?.precinct_desc ?? m },
  { key: "context",   header: "Context",       width: 22, value: (r, m) => r.interactions?.captured_location ?? m },
  { key: "sentiment", header: "Sentiment",     width: 18, value: (r, m) => r.sentiment ?? m },
  { key: "issues",    header: "Issues",        width: 32, value: (r) => (r.issues ?? []).join(", ") },
  { key: "tags",      header: "Tags",          width: 32, value: (r) => (r.tags ?? []).join(", ") },
  { key: "notes",     header: "Notes",         width: 60, value: (r, m) => r.notes ?? r.interactions?.notes ?? m },
  { key: "captured",  header: "Captured name", width: 22, value: (r) => r.captured_name ?? "" },
  { key: "relation",  header: "Role",          width: 14, value: (r) => r.is_primary ? "lead" : (r.relationship ?? "") },
  { key: "matched",   header: "Voter file",    width: 28, value: (r) => r.voter_ncid ? "matched" : "unmatched — no previous voter or no data found" },
];

const DEFAULT_KEYS = ALL_COLUMNS.map((c) => c.key);

export async function GET(req: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const missing = url.searchParams.get("missing") ?? "NA";
  const includeUnmatched = (url.searchParams.get("include_unmatched") ?? "1") !== "0";
  const requestedKeys = url.searchParams.get("columns")?.split(",").map((k) => k.trim()).filter(Boolean);
  const selectedKeys = requestedKeys?.length ? requestedKeys : DEFAULT_KEYS;
  const columns = ALL_COLUMNS.filter((c) => selectedKeys.includes(c.key));
  if (columns.length === 0) {
    return Response.json({ error: "no valid columns selected" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("interaction_participants")
    .select(
      "id, captured_name, voter_ncid, sentiment, issues, tags, notes, relationship, is_primary, interactions(created_at, captured_location, notes), voters(first_name, last_name, res_street_address, res_city, res_zip, party_cd, birth_year, precinct_desc)",
    )
    .returns<Row[]>();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (data ?? [])
    .filter((r) => includeUnmatched || r.voter_ncid !== null)
    .sort((a, b) => {
      const aT = a.interactions?.created_at ?? "";
      const bT = b.interactions?.created_at ?? "";
      return bT.localeCompare(aT);
    });

  const wb = new ExcelJS.Workbook();
  wb.creator = "JED";
  wb.created = new Date();
  const ws = wb.addWorksheet("Interactions");

  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFDBEAFE" },
  };

  for (const r of rows) {
    const cells: Record<string, string | Date> = {};
    for (const c of columns) cells[c.key] = c.value(r, missing);
    ws.addRow(cells);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="jed-interactions-${stamp}.xlsx"`,
    },
  });
}
