"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MeetingRow } from "./page";

export default function MeetingsClient({ initial }: { initial: MeetingRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<MeetingRow[]>(initial);
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<MeetingRow | null>(null);

  function refresh() {
    router.refresh();
  }

  async function remove(m: MeetingRow) {
    if (!confirm(`Delete "${m.title}"? This can't be undone.`)) return;
    const res = await fetch(`/api/meetings/${m.id}`, { method: "DELETE" });
    if (res.ok) {
      setRows((cur) => cur.filter((r) => r.id !== m.id));
      refresh();
    } else {
      alert("Delete failed");
    }
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <span className="text-xs text-[var(--color-ink-subtle)]">
          {rows.length} {rows.length === 1 ? "meeting" : "meetings"}
        </span>
        <button onClick={() => setComposing(true)} className="btn-primary">
          + New meeting
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="card p-5 text-sm text-[var(--color-ink-subtle)]">
          No meetings yet. Click <strong>New meeting</strong> to log one.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((m) => (
            <li key={m.id} className="card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold">{m.title}</h3>
                  <div className="mt-1 flex flex-wrap items-baseline gap-2 text-xs text-[var(--color-ink-subtle)]">
                    {m.meeting_date && <span>{new Date(m.meeting_date).toLocaleString()}</span>}
                    {m.location && <span>· {m.location}</span>}
                    {m.duration_min != null && <span>· {m.duration_min} min</span>}
                  </div>
                  {m.attendees && m.attendees.length > 0 && (
                    <div className="mt-1 text-xs text-[var(--color-ink-muted)]">
                      With {m.attendees.join(", ")}
                    </div>
                  )}
                  {m.tags && m.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {m.tags.map((t) => (
                        <span key={t} className="chip chip-neutral">{t}</span>
                      ))}
                    </div>
                  )}
                  {m.body && (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--color-ink-muted)]">
                      {m.body}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <a
                    href={`/api/meetings/${m.id}/ics`}
                    className="btn-ghost text-xs"
                    title="Download .ics → import into Google Calendar / Apple / Outlook"
                  >
                    Add to calendar
                  </a>
                  <button
                    onClick={() => setEditing(m)}
                    className="btn-ghost text-xs"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(m)}
                    className="btn-ghost text-xs text-[var(--color-danger)]"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {composing && (
        <ComposeMeetingModal
          onClose={() => setComposing(false)}
          onSaved={(m) => {
            setRows((cur) => [m, ...cur]);
            setComposing(false);
            refresh();
          }}
        />
      )}

      {editing && (
        <ComposeMeetingModal
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={(m) => {
            setRows((cur) => cur.map((r) => (r.id === m.id ? m : r)));
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function ComposeMeetingModal({
  existing,
  onClose,
  onSaved,
}: {
  existing?: MeetingRow;
  onClose: () => void;
  onSaved: (m: MeetingRow) => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [body, setBody] = useState(existing?.body ?? "");
  const [date, setDate] = useState(
    existing?.meeting_date
      ? new Date(existing.meeting_date).toISOString().slice(0, 16)
      : "",
  );
  const [duration, setDuration] = useState(
    existing?.duration_min != null ? String(existing.duration_min) : "",
  );
  const [location, setLocation] = useState(existing?.location ?? "");
  const [attendees, setAttendees] = useState((existing?.attendees ?? []).join(", "));
  const [tags, setTags] = useState((existing?.tags ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    const payload: Record<string, unknown> = {
      title: title.trim(),
      body: body.trim() || null,
      meeting_date: date ? new Date(date).toISOString() : null,
      duration_min: duration ? Math.max(0, parseInt(duration, 10)) : null,
      location: location.trim() || null,
      attendees: attendees.split(",").map((s) => s.trim()).filter(Boolean),
      tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
    };
    const res = await fetch(
      existing ? `/api/meetings/${existing.id}` : "/api/meetings",
      {
        method: existing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const json = await res.json();
    setSaving(false);
    if (!res.ok) {
      setErr(json.error ?? "save failed");
      return;
    }
    const result: MeetingRow = existing
      ? { ...existing, ...payload, id: existing.id } as MeetingRow
      : ({ ...payload, ...json.meeting, body: payload.body, attendees: payload.attendees, tags: payload.tags } as MeetingRow);
    onSaved(result);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-2xl max-h-[85vh] flex flex-col p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-base font-semibold">
            {existing ? "Edit meeting" : "New meeting"}
          </h3>
          <button onClick={onClose} className="btn-ghost text-xs">Close</button>
        </div>

        <div className="space-y-3 overflow-auto">
          <label className="block">
            <span className="section-label">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input mt-1"
              placeholder="e.g. Coffee with Carla — schools / safe routes"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="section-label">When</span>
              <input
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="input mt-1"
              />
            </label>
            <label className="block">
              <span className="section-label">Duration (min)</span>
              <input
                type="number"
                min={0}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="input mt-1"
                placeholder="60"
              />
            </label>
          </div>
          <label className="block">
            <span className="section-label">Location</span>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="input mt-1"
              placeholder="Coffee shop / Zoom / address"
            />
          </label>
          <label className="block">
            <span className="section-label">Attendees</span>
            <input
              value={attendees}
              onChange={(e) => setAttendees(e.target.value)}
              className="input mt-1"
              placeholder="comma-separated, e.g. Carla Hernandez, Jane Lopez"
            />
          </label>
          <label className="block">
            <span className="section-label">Tags</span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="input mt-1"
              placeholder="comma-separated, e.g. fundraising, schools"
            />
          </label>
          <label className="block">
            <span className="section-label">Notes</span>
            <textarea
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="input mt-1"
              placeholder="Substance, decisions, follow-ups..."
            />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving || title.trim().length === 0}
            className="btn-primary"
          >
            {saving ? "Saving..." : existing ? "Save changes" : "Create meeting"}
          </button>
          {err && <span className="text-sm text-[var(--color-danger)]">{err}</span>}
        </div>
      </div>
    </div>
  );
}
