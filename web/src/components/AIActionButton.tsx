"use client";

import { useState } from "react";

type RenderFn<T> = (data: T) => React.ReactNode;

type Props<T> = {
  label: string;
  endpoint: string;
  title: string;
  render: RenderFn<T>;
  resultKey: string; // property name in the JSON response (e.g. "brief", "draft")
  className?: string;
};

export default function AIActionButton<T>({
  label,
  endpoint,
  title,
  render,
  resultKey,
  className,
}: Props<T>) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function run() {
    setLoading(true);
    setErr(null);
    setOpen(true);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "AI call failed");
      setData(json[resultKey] as T);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button onClick={run} className={className ?? "btn-secondary"}>
        {label}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => !loading && setOpen(false)}
        >
          <div
            className="card max-h-[85vh] w-full max-w-lg overflow-auto p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-base font-semibold text-[var(--color-primary)]">{title}</h3>
              <button onClick={() => setOpen(false)} className="btn-ghost text-xs">Close</button>
            </div>
            {loading && (
              <p className="text-sm text-[var(--color-ink-subtle)]">
                Asking Claude... (usually 3-6 seconds)
              </p>
            )}
            {err && (
              <p className="rounded-md bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">
                {err}
              </p>
            )}
            {data && render(data)}
          </div>
        </div>
      )}
    </>
  );
}

export function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card-quiet p-3">
      <pre className="whitespace-pre-wrap text-sm text-[var(--color-ink)]">{text}</pre>
      <button
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="btn-ghost mt-2 text-xs"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
