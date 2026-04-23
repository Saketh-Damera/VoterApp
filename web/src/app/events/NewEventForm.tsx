"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewEventForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [when, setWhen] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        location: location.trim() || null,
        event_date: when ? new Date(when).toISOString() : null,
        notes: notes.trim() || null,
      }),
    });
    const json = await res.json();
    setBusy(false);
    if (!json.ok) {
      setErr(json.error ?? "failed");
      return;
    }
    router.push(`/events/${json.event.id}`);
  }

  return (
    <form onSubmit={submit} className="card flex flex-col gap-3 p-4">
      <input
        placeholder="Title (e.g. PTA house party at Maria's)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="input"
        required
      />
      <input
        placeholder="Location"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        className="input"
      />
      <input
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        className="input"
      />
      <textarea
        placeholder="Notes (private — won't be shown in the brief)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        className="input"
      />
      <button type="submit" disabled={busy || !title.trim()} className="btn-primary">
        {busy ? "Creating..." : "Create event"}
      </button>
      {err && <p className="text-sm text-[var(--color-danger)]">{err}</p>}
    </form>
  );
}
