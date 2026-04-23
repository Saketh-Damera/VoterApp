"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Result = {
  inserted: number;
  mapping: Record<string, string | null>;
};

export default function DonorImportClient() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setErr("Pick a file");
      return;
    }
    setBusy(true);
    setErr(null);
    setResult(null);

    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch("/api/fundraising/import", { method: "POST", body: fd });
    const json = await res.json();
    setBusy(false);

    if (!res.ok) {
      setErr(json.error ?? "import failed");
      return;
    }
    setResult({ inserted: json.inserted, mapping: json.mapping });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="card flex flex-col gap-3 p-4">
        <label className="flex flex-col gap-1">
          <span className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-ink-subtle)]">File</span>
          <input
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="input"
            required
          />
          <span className="mt-1 text-xs text-[var(--color-ink-subtle)]">
            CSV, TSV, or Excel. Max 5 MB. First row should be column headers.
          </span>
        </label>

        <button type="submit" disabled={busy || !file} className="btn-primary">
          {busy ? "Parsing & mapping columns..." : "Upload"}
        </button>
        {err && <p className="text-sm text-[var(--color-danger)]">{err}</p>}
      </form>

      {result && (
        <div className="space-y-3">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <strong className="text-emerald-800">Imported {result.inserted} donors.</strong>
          </div>
          <div className="card p-4">
            <div className="section-label mb-2">Column mapping (by Claude)</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--color-ink-subtle)]">
                  <th className="pb-1 pr-4">Canonical</th>
                  <th className="pb-1">Source column</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.mapping).map(([k, v]) => (
                  <tr key={k} className="border-t border-[var(--color-border)]">
                    <td className="py-1 pr-4 font-mono">{k}</td>
                    <td className="py-1">
                      {v ? <span className="font-mono">{v}</span> : <span className="text-[var(--color-ink-subtle)]">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button onClick={() => router.push("/fundraising")} className="btn-primary">
              View donors
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
