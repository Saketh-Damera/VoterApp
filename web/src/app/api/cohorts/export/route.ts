import { NextRequest } from "next/server";
import { z } from "zod";
import ExcelJS from "exceljs";
import { getSupabaseServer } from "@/lib/supabase/server";
import { parseOrThrow } from "@/lib/parseOrThrow";
import { makeRequestLogger, newRequestId } from "@/lib/logger";
import { errorToResponse, UnauthorizedError } from "@/domain/errors";
import { CohortFilter, buildCohort } from "@/domain/ai/cohortBuilder";

export const runtime = "nodejs";

// Reuses the filter the user just produced via /api/cohorts/build. Sending
// the filter (rather than re-describing) avoids a second AI round-trip.
const BodySchema = z.object({
  filter: CohortFilter,
  list_id: z.string().uuid().nullable().optional(),
  limit: z.number().int().min(1).max(5000).optional(),
  filename: z.string().min(1).max(120).optional(),
});

export async function POST(req: NextRequest) {
  const requestId = newRequestId();
  const rlog = makeRequestLogger({ request_id: requestId, route: "POST /api/cohorts/export" });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError("not signed in");

    const body = await req.json().catch(() => ({}));
    const { filter, list_id, limit, filename } = parseOrThrow(BodySchema, body);

    const voters = await buildCohort(supabase, filter, { listId: list_id ?? null, limit });

    const wb = new ExcelJS.Workbook();
    wb.creator = "JED";
    wb.created = new Date();
    const ws = wb.addWorksheet("Cohort");
    ws.columns = [
      { header: "First", key: "first", width: 14 },
      { header: "Middle", key: "middle", width: 10 },
      { header: "Last", key: "last", width: 16 },
      { header: "Address", key: "address", width: 32 },
      { header: "City", key: "city", width: 14 },
      { header: "ZIP", key: "zip", width: 8 },
      { header: "Party", key: "party", width: 8 },
      { header: "Age", key: "age", width: 6 },
      { header: "Phone", key: "phone", width: 16 },
      { header: "Email", key: "email", width: 26 },
      { header: "Precinct", key: "precinct", width: 18 },
      { header: "Municipality", key: "municipality", width: 18 },
      { header: "NCID", key: "ncid", width: 22 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFDBEAFE" },
    };
    for (const v of voters) {
      ws.addRow({
        first: v.first_name ?? "",
        middle: v.middle_name ?? "",
        last: v.last_name ?? "",
        address: v.res_street_address ?? "",
        city: v.res_city ?? "",
        zip: v.res_zip ?? "",
        party: v.party_cd ?? "",
        age: v.age ?? "",
        phone: v.phone ?? "",
        email: v.email ?? "",
        precinct: v.precinct_desc ?? "",
        municipality: v.municipality_desc ?? "",
        ncid: v.ncid,
      });
    }

    rlog.info("cohort.export.ok", { user_id: user.id, rows: voters.length });
    const buf = await wb.xlsx.writeBuffer();
    const safeName = (filename ?? `cohort-${new Date().toISOString().slice(0, 10)}`)
      .replace(/[^a-zA-Z0-9_-]/g, "-");
    return new Response(buf as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safeName}.xlsx"`,
        "x-request-id": requestId,
      },
    });
  } catch (e) {
    rlog.error("cohort.export.failed", { err: e instanceof Error ? e.message : String(e) });
    const resp = errorToResponse(e);
    resp.headers.set("x-request-id", requestId);
    return resp;
  }
}
