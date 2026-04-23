"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function FundraiseButton({ ncid }: { ncid: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function track() {
    setBusy(true);
    await fetch(`/api/voters/${ncid}/fundraise`, { method: "POST" });
    router.refresh();
  }

  return (
    <button onClick={track} disabled={busy} className="btn-primary text-xs">
      {busy ? "…" : "+ Track for fundraising"}
    </button>
  );
}
