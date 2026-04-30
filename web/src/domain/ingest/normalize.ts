// Pure helpers used by the voter list ingest pipeline. Extracted into their
// own module so unit tests can exercise them without booting Next.

import crypto from "node:crypto";

const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v", "vi"]);

export function splitFullName(full: string): {
  first: string | null;
  middle: string | null;
  last: string | null;
  suffix: string | null;
} {
  const trimmed = (full ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return { first: null, middle: null, last: null, suffix: null };

  // "Last, First [Middle...] [Suffix]"
  if (trimmed.includes(",")) {
    const [lastPart, restPart = ""] = trimmed.split(",", 2).map((s) => s.trim());
    const restTokens = restPart.split(" ").filter(Boolean);
    let suffix: string | null = null;
    if (restTokens.length > 1 && SUFFIXES.has(restTokens[restTokens.length - 1].toLowerCase())) {
      suffix = restTokens.pop() ?? null;
    }
    const first = restTokens.shift() ?? null;
    const middle = restTokens.length ? restTokens.join(" ") : null;
    return { first, middle, last: lastPart || null, suffix };
  }

  // "First [Middle...] Last [Suffix]"
  const tokens = trimmed.split(" ");
  let suffix: string | null = null;
  if (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1].toLowerCase())) {
    suffix = tokens.pop() ?? null;
  }
  if (tokens.length === 1) return { first: tokens[0], middle: null, last: null, suffix };
  if (tokens.length === 2) return { first: tokens[0], middle: null, last: tokens[1], suffix };
  return {
    first: tokens[0],
    middle: tokens.slice(1, -1).join(" ") || null,
    last: tokens[tokens.length - 1],
    suffix,
  };
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

export function normalizeDate(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = String(s).trim();
  if (!t) return null;

  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;

  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const yy = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    return `${yy}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }

  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = t.match(/^([A-Za-z]+)[\s,]+(\d{1,2})[\s,]+(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[2].padStart(2, "0")}`;
  }

  m = t.match(/^(\d{1,2})[\s-]([A-Za-z]+)[\s-](\d{2,4})$/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon) {
      const yy = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
      return `${yy}-${mon}-${m[1].padStart(2, "0")}`;
    }
  }

  return null;
}

// Deterministic globally-unique voter ncid.
export function stableNcid(o: {
  rawId: string | null;
  state: string | null;
  first: string | null;
  last: string | null;
  address: string | null;
  city: string | null;
  listId: string;
  idx: number;
}): string {
  if (o.rawId) {
    return o.state ? `${o.state}:${o.rawId}` : o.rawId;
  }
  const key = [o.state ?? "", o.last ?? "", o.first ?? "", o.address ?? "", o.city ?? ""]
    .map((s) => s.toLowerCase().trim())
    .join("|");
  if (key.replace(/\|/g, "").length < 3) {
    return `${o.listId.slice(0, 8)}-${o.idx + 1}`;
  }
  const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 16);
  return o.state ? `H:${o.state}:${hash}` : `H:${hash}`;
}
