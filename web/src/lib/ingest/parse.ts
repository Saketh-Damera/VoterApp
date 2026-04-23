import Papa from "papaparse";
import ExcelJS from "exceljs";

export type ParsedFile = {
  headers: string[];
  rows: Record<string, string>[];
  sampleRows: Record<string, string>[]; // up to 5 rows for Claude
  totalRows: number;
};

const MAX_ROWS = 20000;
const SAMPLE_SIZE = 5;

export async function parseUploadedFile(
  filename: string,
  buffer: ArrayBuffer,
): Promise<ParsedFile> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return parseXlsx(buffer);
  // CSV / TSV / TXT: let papaparse sniff the delimiter
  return parseDelimited(buffer);
}

async function parseXlsx(buffer: ArrayBuffer): Promise<ParsedFile> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("XLSX file has no worksheets");

  // Find the first row that looks like a header (contains text, not all blank)
  let headerRowIndex = 1;
  for (let r = 1; r <= Math.min(ws.rowCount, 20); r++) {
    const row = ws.getRow(r);
    const values = (row.values as (string | number | null | undefined)[]).slice(1);
    const nonEmpty = values.filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
    if (nonEmpty.length >= 3) {
      headerRowIndex = r;
      break;
    }
  }

  const headers = ((ws.getRow(headerRowIndex).values as unknown[]).slice(1) as unknown[])
    .map((v) => (v == null ? "" : String(v).trim()));

  const rows: Record<string, string>[] = [];
  for (let r = headerRowIndex + 1; r <= ws.rowCount && rows.length < MAX_ROWS; r++) {
    const raw = (ws.getRow(r).values as unknown[]).slice(1) as unknown[];
    const row: Record<string, string> = {};
    let anyValue = false;
    headers.forEach((h, i) => {
      if (!h) return;
      const cell = raw[i];
      const v = cell == null ? "" : String(cell).trim();
      if (v !== "") anyValue = true;
      row[h] = v;
    });
    if (anyValue) rows.push(row);
  }

  return {
    headers: headers.filter((h) => h),
    rows,
    sampleRows: rows.slice(0, SAMPLE_SIZE),
    totalRows: rows.length,
  };
}

async function parseDelimited(buffer: ArrayBuffer): Promise<ParsedFile> {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    delimiter: "", // auto-detect
    dynamicTyping: false,
    preview: MAX_ROWS,
  });
  const headers = (result.meta.fields ?? []).map((h) => h.trim());
  const rows = (result.data as Record<string, string>[]).map((r) => {
    const out: Record<string, string> = {};
    for (const h of headers) {
      const v = r[h];
      out[h] = v == null ? "" : String(v).trim();
    }
    return out;
  });
  return {
    headers,
    rows,
    sampleRows: rows.slice(0, SAMPLE_SIZE),
    totalRows: rows.length,
  };
}
