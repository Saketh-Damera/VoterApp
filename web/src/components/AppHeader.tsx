import Link from "next/link";
import LogoutButton from "./LogoutButton";
import QuickSearch from "./QuickSearch";
import JedLogo from "./JedLogo";

export type CandidateProfile = {
  candidate_name: string;
  office: string | null;
  jurisdiction: string | null;
  election_date: string | null;
};

export default function AppHeader({ profile }: { profile: CandidateProfile | null }) {
  const daysUntil = profile?.election_date ? daysUntilElection(profile.election_date) : null;
  const dayLabel = formatDaysUntil(daysUntil);

  return (
    <header className="mb-6 border-b border-[var(--color-border)] pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <JedLogo size="md" />
          <div className="border-l border-[var(--color-border)] pl-4">
            <Link href="/" className="block">
              <div className="text-sm font-medium text-[var(--color-ink)]">
                {profile?.candidate_name ?? "—"}
              </div>
              {profile?.office && (
                <p className="text-xs text-[var(--color-ink-subtle)]">
                  {profile.office}
                  {profile.jurisdiction ? ` · ${profile.jurisdiction}` : ""}
                </p>
              )}
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dayLabel && (
            <span className={`chip ${daysUntil !== null && daysUntil <= 7 ? "chip-warning" : "chip-primary"}`}>
              {dayLabel}
            </span>
          )}
          <Link href="/clusters" className="btn-ghost" title="Address clusters">📍 Clusters</Link>
          <Link href="/lists" className="btn-ghost" title="Voter lists">📋 Lists</Link>
          <Link href="/people/new" className="btn-primary">+ Add Person</Link>
          <Link href="/settings" className="btn-ghost" title="Settings">⚙</Link>
          <LogoutButton />
        </div>
      </div>
      <div className="mt-3">
        <QuickSearch />
      </div>
    </header>
  );
}

function daysUntilElection(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const election = new Date(iso + "T00:00:00");
  return Math.round((election.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDaysUntil(n: number | null): string | null {
  if (n === null) return null;
  if (n < 0) return `Election ${Math.abs(n)}d ago`;
  if (n === 0) return "Election today";
  if (n === 1) return "Election tomorrow";
  return `${n} days to election`;
}
