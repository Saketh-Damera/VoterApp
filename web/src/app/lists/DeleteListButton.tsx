"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function DeleteListButton({
  listId,
  listName,
}: {
  listId: string;
  listName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  async function onClick() {
    if (!confirm(`Delete "${listName}"? Voters that only belong to this list are removed; conversations remain (any unmatched voter will show up on Voters contacted).`)) {
      return;
    }
    setErr(null);
    const res = await fetch(`/api/lists/${listId}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setErr(json.error ?? "delete failed");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={onClick}
        disabled={isPending}
        className="btn-ghost text-xs text-[var(--color-danger)]"
        title="Delete this list"
      >
        {isPending ? "Deleting..." : "Delete"}
      </button>
      {err && <span className="text-xs text-[var(--color-danger)]">{err}</span>}
    </div>
  );
}
