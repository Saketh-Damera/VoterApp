"use client";

import { useState } from "react";
import JedLogo from "./JedLogo";

const SUGGESTIONS = [
  "Show me everyone I talked to last week.",
  "Find conversations that mentioned schools.",
  "Who at the PTA meeting cared about traffic?",
  "List voters in Ward 2 I've spoken to.",
];

export default function AskJedCard() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function ask(question: string) {
    const body = question.trim();
    if (!body) return;
    setLoading(true);
    setErr(null);
    setAnswer(null);
    try {
      const res = await fetch("/api/ask-jed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: body }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "failed");
      } else {
        setAnswer(json.answer ?? "(empty response)");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card mb-10 p-5">
      <div className="mb-3 flex items-center gap-3">
        <JedLogo size="sm" href="" />
        <span className="text-sm text-[var(--color-ink-subtle)]">
          Search your campaign data — names, conversations, issues, places.
        </span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. Find conversations that mentioned schools"
          className="input flex-1"
          disabled={loading}
        />
        <button type="submit" disabled={loading || !q.trim()} className="btn-primary">
          {loading ? "Thinking..." : "Ask"}
        </button>
      </form>

      {!answer && !loading && !err && (
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => { setQ(s); ask(s); }}
              className="chip chip-neutral cursor-pointer hover:bg-[var(--color-surface-muted)]"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {err && (
        <p className="mt-3 rounded-md bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {err}
        </p>
      )}

      {answer && (
        <div className="mt-4 whitespace-pre-wrap rounded-md bg-[var(--color-surface-muted)] px-4 py-3 text-sm leading-relaxed text-[var(--color-ink)]">
          {answer}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => { setAnswer(null); setQ(""); }}
              className="btn-ghost text-xs"
            >
              Ask another
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
