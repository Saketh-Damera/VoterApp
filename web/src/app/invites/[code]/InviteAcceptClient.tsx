"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function InviteAcceptClient({ code }: { code: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function accept() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(code)}/accept`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "couldn't accept invite");
        return;
      }
      setDone(true);
      // Send the volunteer to the dashboard once they're a member.
      setTimeout(() => router.push("/"), 800);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="card bg-emerald-50 p-4 text-sm text-emerald-800">
        Invite accepted. Taking you to the dashboard...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button onClick={accept} disabled={loading} className="btn-primary">
        {loading ? "Accepting..." : "Accept invite"}
      </button>
      {err && (
        <p className="text-sm text-[var(--color-danger)]">{err}</p>
      )}
    </div>
  );
}
