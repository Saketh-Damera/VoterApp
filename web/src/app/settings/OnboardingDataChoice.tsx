"use client";

import Link from "next/link";
import { useState } from "react";

const STATE_HINTS: Record<string, string> = {
  NC: "NC State Board of Elections: ncsbe.gov/results-data/voter-registration-data (free, statewide, updated weekly)",
  NJ: "Request from county clerk or NJ Division of Elections (paid/gated, varies by county)",
  CA: "Request via the Secretary of State (restricted — for candidates and committees only)",
  TX: "Texas Secretary of State voter roll (paid — around $200 statewide)",
  FL: "Florida Division of Elections (free statewide extract)",
  NY: "County Boards of Elections (county-level, free)",
  GA: "GA Secretary of State (free statewide extract, weekly refresh)",
  PA: "PA Department of State (free statewide — request form)",
  OH: "OH Secretary of State (free statewide download)",
  VA: "VA Department of Elections (restricted — campaigns only)",
  MA: "MA Secretary of State (paid — county or statewide)",
  WA: "WA Secretary of State (free statewide extract)",
  MI: "MI Secretary of State (free quarterly extract)",
};

export default function OnboardingDataChoice({ hasOwnList }: { hasOwnList: boolean }) {
  const [state, setState] = useState<string>("");

  return (
    <div className="space-y-4">
      {/* Option A: use sample */}
      <div className="card p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-ink)]">Start with sample data</h3>
            <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">
              Use the NC Durham County voter list (205,496 voters, 1.2M vote records) to explore how JED
              works. Your interactions stay private to your account.
            </p>
          </div>
          <Link href="/map" className="btn-primary whitespace-nowrap text-sm">
            Explore sample
          </Link>
        </div>
      </div>

      {/* Option B: upload your own */}
      <div className="card p-4">
        <h3 className="text-sm font-semibold text-[var(--color-ink)]">
          Upload your own voter file
          {hasOwnList && (
            <span className="ml-2 text-xs font-normal text-[var(--color-success)]">
              (you&apos;ve already uploaded one)
            </span>
          )}
        </h3>
        <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">
          CSV, TSV, or XLSX. JED auto-maps columns — you don&apos;t need a specific format.
        </p>

        <label className="mt-3 block">
          <span className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-ink-subtle)]">
            Where to find voter data in your state
          </span>
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="input mt-1"
          >
            <option value="">Pick your state for a pointer...</option>
            {Object.keys(STATE_HINTS).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
            <option value="OTHER">Other / not listed</option>
          </select>
          {state && state !== "OTHER" && (
            <p className="mt-2 rounded-md bg-[var(--color-surface-muted)] p-2 text-xs text-[var(--color-ink-muted)]">
              {STATE_HINTS[state]}
            </p>
          )}
          {state === "OTHER" && (
            <p className="mt-2 rounded-md bg-[var(--color-surface-muted)] p-2 text-xs text-[var(--color-ink-muted)]">
              Most states publish voter rolls through their Secretary of State or Board of Elections.
              Search &quot;[your state] voter file request&quot; — public files are usually free, restricted files
              require being a candidate or committee.
            </p>
          )}
        </label>

        <div className="mt-4">
          <Link href="/lists/new" className="btn-primary text-sm">
            Upload voter file
          </Link>
        </div>
      </div>
    </div>
  );
}
