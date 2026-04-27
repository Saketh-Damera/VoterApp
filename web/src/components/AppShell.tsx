import Link from "next/link";
import LogoutButton from "./LogoutButton";
import QuickSearch from "./QuickSearch";
import JedLogo from "./JedLogo";
import MobileNav from "./MobileNav";

export type CandidateProfile = {
  candidate_name: string;
  office: string | null;
  jurisdiction: string | null;
  election_date: string | null;
};

type NavItem = { href: string; label: string };

const NAV: NavItem[] = [
  { href: "/",         label: "Dashboard" },
  { href: "/debrief",  label: "Talk to JED" },
  { href: "/people",   label: "Voters contacted" },
  { href: "/map",      label: "Map" },
  { href: "/lists",    label: "Voter lists" },
  { href: "/settings", label: "Settings" },
];

export default function AppShell({
  profile,
  children,
}: {
  profile: CandidateProfile | null;
  children: React.ReactNode;
}) {
  const daysUntil = profile?.election_date ? daysUntilElection(profile.election_date) : null;
  const dayLabel = formatDaysUntil(daysUntil);

  return (
    <div className="flex min-h-dvh">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:flex md:flex-col">
        <div className="mb-2 flex items-center justify-center">
          <JedLogo size="md" />
        </div>
        <div className="mb-4 border-b border-[var(--color-border)] pb-3 text-center">
          <div className="truncate text-sm font-medium text-[var(--color-ink)]">
            {profile?.candidate_name ?? "—"}
          </div>
          {profile?.office && (
            <div className="truncate text-xs text-[var(--color-ink-subtle)]">{profile.office}</div>
          )}
          {dayLabel && (
            <span
              className={`mt-2 inline-block chip ${
                daysUntil !== null && daysUntil <= 7 ? "chip-warning" : "chip-primary"
              }`}
            >
              {dayLabel}
            </span>
          )}
        </div>

        <nav className="flex-1 space-y-0.5">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm text-[var(--color-ink-muted)] transition hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-primary)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex w-full items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 md:hidden">
        <Link href="/" aria-label="Home">
          <JedLogo size="sm" href="" />
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/people/new" className="btn-primary text-sm whitespace-nowrap">Add</Link>
          <MobileNav items={NAV} />
        </div>
      </div>

      {/* Main column */}
      <div className="flex-1 min-w-0">
        {/* Desktop top-right action bar */}
        <div className="sticky top-0 z-20 hidden items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3 md:flex">
          <div className="flex-1">
            <QuickSearch />
          </div>
          <Link href="/people/new" className="btn-primary whitespace-nowrap">
            Add Person
          </Link>
          <LogoutButton />
        </div>

        {/* Mobile: quick search below the nav bar */}
        <div className="md:hidden px-4 py-3">
          <QuickSearch />
        </div>

        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-5 sm:py-6">
          {children}
        </div>
      </div>
    </div>
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
  if (n < 0) return `${Math.abs(n)}d post-election`;
  if (n === 0) return "Election today";
  if (n === 1) return "Election tomorrow";
  return `${n} days to go`;
}
