"use client";

import { useState } from "react";
import Link from "next/link";
import LogoutButton from "./LogoutButton";

type NavItem = { href: string; label: string };

export default function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="rounded-md border border-[var(--color-border-strong)] px-3 py-2 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-muted)]"
      >
        Menu
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40"
          onClick={() => setOpen(false)}
        >
          <div
            className="absolute right-0 top-0 h-full w-72 max-w-[85vw] border-l border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <span className="section-label">Menu</span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="btn-ghost text-sm"
              >
                Close
              </button>
            </div>

            <nav className="space-y-1">
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-md px-3 py-3 text-base text-[var(--color-ink-muted)] transition hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-ink)]"
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="mt-6 border-t border-[var(--color-border)] pt-4">
              <LogoutButton />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
