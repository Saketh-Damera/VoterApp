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
  // CSV / TSV / TXT / pipe-delimited: papaparse auto-detects the delimiter
  return parseDelimited(buffer);
}

// ExcelJS cells can be strings, numbers, JS Dates, formula objects, hyperlink
// objects, or rich-text objects. Normalize all of them to a clean string.
function cellToString(cell: unknown): string {
  if (cell == null) return "";
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  if (typeof cell === "number" || typeof cell === "boolean") return String(cell);
  if (typeof cell === "string") return cell.trim();
  if (typeof cell === "object") {
    const obj = cell as Record<string, unknown>;
    // Formula cell: { formula, result }
    if ("result" in obj) return cellToString(obj.result);
    // Hyperlink cell: { text, hyperlink }
    if ("text" in obj && typeof obj.text === "string") return obj.text.trim();
    // Rich text: { richText: [{ text }, ...] }
    if (Array.isArray(obj.richText)) {
      return obj.richText
        .map((p) => (typeof p === "object" && p && "text" in p ? String((p as { text: unknown }).text ?? "") : ""))
        .join("")
        .trim();
    }
    // Shared-string cell: { sharedString: "..." }
    if ("sharedString" in obj && typeof obj.sharedString === "string") return obj.sharedString.trim();
    // Error cell: skip
    if ("error" in obj) return "";
  }
  return String(cell).trim();
}

async function parseXlsx(buffer: ArrayBuffer): Promise<ParsedFile> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("XLSX file has no worksheets");

  // Find the first row that looks like a header (3+ non-empty values)
  let headerRowIndex = 1;
  for (let r = 1; r <= Math.min(ws.rowCount, 20); r++) {
    const values = (ws.getRow(r).values as unknown[]).slice(1);
    const nonEmpty = values.filter((v) => cellToString(v) !== "");
    if (nonEmpty.length >= 3) {
      headerRowIndex = r;
      break;
    }
  }

  const rawHeaders = (ws.getRow(headerRowIndex).values as unknown[]).slice(1);
  const headers = rawHeaders.map((v) => cellToString(v));

  const rows: Record<string, string>[] = [];
  for (let r = headerRowIndex + 1; r <= ws.rowCount && rows.length < MAX_ROWS; r++) {
    const raw = (ws.getRow(r).values as unknown[]).slice(1);
    const row: Record<string, string> = {};
    let anyValue = false;
    headers.forEach((h, i) => {
      if (!h) return;
      const v = cellToString(raw[i]);
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
  // Try utf-8 first; fall back to latin1 if there are replacement chars
  // (state voter files are often Windows-1252 / latin1).
  let text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (text.includes("�")) {
    text = new TextDecoder("latin1").decode(buffer);
  }
  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    delimiter: "", // auto-detect: comma, tab, pipe, semicolon
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
