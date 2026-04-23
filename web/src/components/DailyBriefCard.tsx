"use client";

import { useEffect, useState } from "react";

type Brief = {
  headline: string;
  top_action: string;
  sentiment_trend: string;
  issue_of_the_week: string;
};

const CACHE_KEY = "jed_daily_brief";

export default function DailyBriefCard() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);

  useEffect(() => {
    // Show cached brief if it's from today
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { date: string; brief: Brief };
        const today = new Date().toDateString();
        if (parsed.date === today) {
          setBrief(parsed.brief);
          setDate(parsed.date);
        }
      } catch {
        // ignore
      }
    }
  }, []);

  async function generate() {
    setLoading(true);
    setErr(null);
    const res = await fetch("/api/daily-brief", { method: "POST" });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setErr(json.error ?? "failed");
      return;
    }
    setBrief(json.brief);
    const today = new Date().toDateString();
    setDate(today);
    localStorage.setItem(CACHE_KEY, JSON.stringify({ date: today, brief: json.brief }));
  }

  return (
    <div className="card border-[var(--color-accent-soft)] bg-gradient-to-br from-white to-[var(--color-accent-soft)]/30 p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="section-label">Daily brief</h2>
        <button onClick={generate} disabled={loading} className="btn-ghost text-xs">
          {loading ? "Thinking..." : brief ? "Refresh" : "Generate"}
        </button>
      </div>
      {err && <p className="text-xs text-[var(--color-danger)]">{err}</p>}
      {!brief && !loading && !err && (
        <p className="text-sm text-[var(--color-ink-subtle)]">
          One-click morning summary: top action, sentiment trend, issue of the week.
        </p>
      )}
      {brief && (
        <div className="space-y-2 text-sm">
          <p className="font-medium text-[var(--color-ink)]">{brief.headline}</p>
          <div>
            <div className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-ink-subtle)]">Top action</div>
            <p className="text-[var(--color-primary)]">{brief.top_action}</p>
          </div>
          <div>
            <div className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-ink-subtle)]">Sentiment trend</div>
            <p className="text-[var(--color-ink-muted)]">{brief.sentiment_trend}</p>
          </div>
          <div>
            <div className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-ink-subtle)]">Issue of the week</div>
            <p className="text-[var(--color-ink-muted)]">{brief.issue_of_the_week}</p>
          </div>
          {date && (
            <p className="text-xs italic text-[var(--color-ink-subtle)]">{date}</p>
          )}
        </div>
      )}
    </div>
  );
}
