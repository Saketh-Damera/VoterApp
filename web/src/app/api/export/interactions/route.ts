import ExcelJS from "exceljs";
import { getSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  captured_name: string;
  captured_location: string | null;
  notes: string | null;
  created_at: string;
  sentiment: string | null;
  issues: string[] | null;
  tags: string[] | null;
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

export async function GET() {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("interactions")
    .select(
      "id, captured_name, captured_location, notes, created_at, sentiment, issues, tags, voters(first_name, last_name, res_street_address, res_city, res_zip, party_cd, birth_year, precinct_desc)",
    )
    .order("created_at", { ascending: false })
    .returns<Row[]>();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const wb = new ExcelJS.Workbook();
  wb.creator = "JED";
  wb.created = new Date();
  const ws = wb.addWorksheet("Interactions");

  ws.columns = [
    { header: "Date", key: "date", width: 18 },
    { header: "First name", key: "first", width: 16 },
    { header: "Last name", key: "last", width: 18 },
    { header: "Address", key: "address", width: 32 },
    { header: "City", key: "city", width: 14 },
    { header: "ZIP", key: "zip", width: 8 },
    { header: "Party", key: "party", width: 8 },
    { header: "Birth year", key: "byear", width: 10 },
    { header: "Precinct", key: "precinct", width: 16 },
    { header: "Context", key: "context", width: 22 },
    { header: "Sentiment", key: "sentiment", width: 18 },
    { header: "Issues", key: "issues", width: 32 },
    { header: "Tags", key: "tags", width: 32 },
    { header: "Notes", key: "notes", width: 60 },
    { header: "Captured name", key: "captured", width: 22 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFDBEAFE" },
  };

  for (const r of data ?? []) {
    const v = r.voters;
    ws.addRow({
      date: new Date(r.created_at),
      first: v?.first_name ?? "",
      last: v?.last_name ?? "",
      address: v?.res_street_address ?? "",
      city: v?.res_city ?? "",
      zip: v?.res_zip ?? "",
      party: v?.party_cd ?? "",
      byear: v?.birth_year ?? "",
      precinct: v?.precinct_desc ?? "",
      context: r.captured_location ?? "",
      sentiment: r.sentiment ?? "",
      issues: (r.issues ?? []).join(", "),
      tags: (r.tags ?? []).join(", "),
      notes: r.notes ?? "",
      captured: r.captured_name,
    });
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
