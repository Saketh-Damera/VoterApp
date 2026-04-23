"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NewListPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [state, setState] = useState("");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{
    rows: number;
    mapping: Record<string, string | null>;
    sample_before: Record<string, string> | null;
    sample_after: Record<string, unknown> | null;
  } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setErr("Pick a file");
      return;
    }
    setErr(null);
    setUploading(true);
    setResult(null);

    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", name.trim() || file.name);
    if (state.trim()) fd.append("state", state.trim().toUpperCase());

    const res = await fetch("/api/lists/upload", { method: "POST", body: fd });
    const json = await res.json();
    setUploading(false);

    if (!res.ok) {
      setErr(json.error ?? "upload failed");
      return;
    }
    setResult({
      rows: json.rows,
      mapping: json.mapping,
      sample_before: json.sample_before,
      sample_after: json.sample_after,
    });
  }

  return (
    <main className="mx-auto max-w-2xl px-5 pb-16 pt-6">
      <header className="mb-5 flex items-center justify-between border-b border-[var(--color-border)] pb-4">
        <Link href="/lists" className="btn-ghost">← Lists</Link>
        <h1 className="text-lg font-semibold text-[var(--color-primary)]">Upload voter list</h1>
        <span className="w-12" />
      </header>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-subtle)]">
            File
          </span>
          <input
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="input"
            required
          />
          <span className="mt-1 text-xs text-[var(--color-ink-subtle)]">
            CSV, TSV, or Excel (.xlsx). Max 5 MB. First row should be column headers.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-subtle)]">
            List name
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Tenafly Registered Voters 2026"
            className="input"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-subtle)]">
            State (optional)
          </span>
          <input
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="NJ"
            maxLength={2}
            className="input"
          />
        </label>

        <button
          type="submit"
          disabled={uploading || !file}
          className="btn-primary"
        >
          {uploading ? "Parsing & mapping columns…" : "Upload"}
        </button>
        {err && <p className="text-sm text-[var(--color-danger)]">{err}</p>}
      </form>

      {result && (
        <section className="mt-8 space-y-4">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm">
            <strong className="text-emerald-800">Imported {result.rows.toLocaleString()} voters.</strong>
          </div>

          <div className="card p-4">
            <h3 className="section-label mb-2">Column mapping (by Claude)</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--color-ink-subtle)]">
                  <th className="pb-1 pr-4">Canonical field</th>
                  <th className="pb-1">Mapped to source column</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.mapping).map(([field, src]) => (
                  <tr key={field} className="border-t border-[var(--color-border)]">
                    <td className="py-1 pr-4 font-mono">{field}</td>
                    <td className="py-1">
                      {src ? (
                        <span className="font-mono">{src}</span>
                      ) : (
                        <span className="text-[var(--color-ink-subtle)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-3">
            <button onClick={() => router.push("/lists")} className="btn-secondary">
              View lists
            </button>
            <button onClick={() => router.push("/people/new")} className="btn-primary">
              Add first person
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
