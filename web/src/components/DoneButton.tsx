"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DoneButton({ reminderId }: { reminderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function markDone(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    await fetch(`/api/reminders/${reminderId}/done`, { method: "POST" });
    router.refresh();
  }

  return (
    <button
      onClick={markDone}
      disabled={busy}
      className="btn-ghost text-xs disabled:opacity-50"
      title="Mark follow-up complete"
    >
      {busy ? "…" : "✓ Done"}
    </button>
  );
}
