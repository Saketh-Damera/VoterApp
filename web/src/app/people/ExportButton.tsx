"use client";

import { useState } from "react";

const COLUMNS: { key: string; header: string }[] = [
  { key: "date",      header: "Date" },
  { key: "first",     header: "First name" },
  { key: "last",      header: "Last name" },
  { key: "address",   header: "Address" },
  { key: "city",      header: "City" },
  { key: "zip",       header: "ZIP" },
  { key: "party",     header: "Party" },
  { key: "byear",     header: "Birth year" },
  { key: "precinct",  header: "Precinct" },
  { key: "context",   header: "Context" },
  { key: "sentiment", header: "Sentiment" },
  { key: "issues",    header: "Issues" },
  { key: "tags",      header: "Tags" },
  { key: "notes",     header: "Notes" },
  { key: "captured",  header: "Captured name" },
  { key: "relation",  header: "Role (lead / spouse / etc.)" },
  { key: "matched",   header: "Voter file (matched / unmatched)" },
];

export default function ExportButton() {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(COLUMNS.map((c) => c.key)));
  const [missing, setMissing] = useState("NA");
  const [includeUnmatched, setIncludeUnmatched] = useState(true);

  function toggle(key: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function buildUrl() {
    const params = new URLSearchParams();
    if (selected.size && selected.size !== COLUMNS.length) {
      params.set("columns", Array.from(selected).join(","));
    }
    if (missing !== "NA") params.set("missing", missing);
    if (!includeUnmatched) params.set("include_unmatched", "0");
    const qs = params.toString();
    return qs ? `/api/export/interactions?${qs}` : "/api/export/interactions";
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-ghost text-xs" title="Download XLSX">
        Export to Excel
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="card w-full max-w-lg max-h-[85vh] flex flex-col p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-base font-semibold">Export options</h3>
              <button onClick={() => setOpen(false)} className="btn-ghost text-xs">Close</button>
            </div>

            <div className="space-y-4 overflow-auto">
              <section>
                <div className="section-label mb-2">Columns</div>
                <div className="grid grid-cols-2 gap-1">
                  {COLUMNS.map((c) => (
                    <label key={c.key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.has(c.key)}
                        onChange={() => toggle(c.key)}
                      />
                      {c.header}
                    </label>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => setSelected(new Set(COLUMNS.map((c) => c.key)))}
                    className="btn-ghost text-xs"
                  >
                    Select all
                  </button>
                  <button
                    onClick={() => setSelected(new Set())}
                    className="btn-ghost text-xs"
                  >
                    Clear
                  </button>
                </div>
              </section>

              <section>
                <label className="block">
                  <span className="section-label">Missing-value placeholder</span>
                  <input
                    value={missing}
                    onChange={(e) => setMissing(e.target.value)}
                    className="input mt-1"
                    placeholder="NA"
                  />
                  <span className="mt-1 block text-xs text-[var(--color-ink-subtle)]">
                    Used in name/address/etc. cells when the voter file did not have that field.
                  </span>
                </label>
              </section>

              <section>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeUnmatched}
                    onChange={(e) => setIncludeUnmatched(e.target.checked)}
                  />
                  Include conversations with no voter-file match
                </label>
                <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">
                  Unmatched rows fill missing fields with the placeholder above and the
                  &quot;Voter file&quot; column reads &quot;unmatched — no previous voter or no data found&quot;.
                </p>
              </section>
            </div>

            <div className="mt-4 flex items-center justify-end gap-3">
              <a
                href={buildUrl()}
                onClick={() => setOpen(false)}
                className="btn-primary"
                aria-disabled={selected.size === 0}
              >
                Download
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
