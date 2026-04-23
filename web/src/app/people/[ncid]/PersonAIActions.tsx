"use client";

import AIActionButton, { CopyBox } from "@/components/AIActionButton";

type Brief = {
  headline: string;
  key_facts: string[];
  issues_they_care_about: string[];
  talking_points: string[];
  suggested_ask: string;
};

type Draft = {
  channel: "sms" | "email" | "handwritten";
  subject: string | null;
  body: string;
  rationale: string;
};

export default function PersonAIActions({ ncid }: { ncid: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <AIActionButton<Brief>
        label="🧠 Brief me"
        className="btn-secondary text-xs"
        endpoint={`/api/voters/${ncid}/brief`}
        resultKey="brief"
        title="Pre-conversation briefing"
        render={(b) => (
          <div className="space-y-4 text-sm">
            <p className="font-medium text-[var(--color-ink)]">{b.headline}</p>
            <div>
              <h4 className="section-label mb-1">Key facts</h4>
              <ul className="list-disc pl-5 text-[var(--color-ink-muted)]">
                {b.key_facts.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
            <div>
              <h4 className="section-label mb-1">Issues they care about</h4>
              <div className="flex flex-wrap gap-1">
                {b.issues_they_care_about.map((x, i) => (
                  <span key={i} className="chip chip-primary">{x}</span>
                ))}
              </div>
            </div>
            <div>
              <h4 className="section-label mb-1">Talking points</h4>
              <ul className="list-disc pl-5 text-[var(--color-ink-muted)]">
                {b.talking_points.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
            <div className="rounded-md border border-[var(--color-accent-soft)] bg-[var(--color-accent-soft)] p-3">
              <div className="section-label mb-1">Suggested ask</div>
              <p className="text-sm text-[var(--color-primary)]">{b.suggested_ask}</p>
            </div>
          </div>
        )}
      />
      <AIActionButton<Draft>
        label="✉ Draft follow-up"
        className="btn-secondary text-xs"
        endpoint={`/api/voters/${ncid}/draft-message`}
        resultKey="draft"
        title="Drafted follow-up"
        render={(d) => (
          <div className="space-y-3">
            <div className="flex items-baseline gap-2 text-xs text-[var(--color-ink-subtle)]">
              <span className="chip chip-primary">{d.channel}</span>
              <span className="italic">{d.rationale}</span>
            </div>
            {d.subject && (
              <div>
                <div className="section-label mb-1">Subject</div>
                <CopyBox text={d.subject} />
              </div>
            )}
            <div>
              <div className="section-label mb-1">Body</div>
              <CopyBox text={d.body} />
            </div>
          </div>
        )}
      />
    </div>
  );
}
