"use client";

import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

export default function DemoBanner() {
  const router = useRouter();
  const supabase = getSupabaseBrowser();

  async function exitDemo() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--color-warning-soft)] bg-[var(--color-warning-soft)] px-3 py-2 text-sm">
      <span className="text-[var(--color-warning)]">
        <strong>Demo mode.</strong> This is a throwaway account — your data here won&apos;t be saved when you leave.
      </span>
      <button onClick={exitDemo} className="btn-ghost text-xs">
        Exit demo & sign in
      </button>
    </div>
  );
}
