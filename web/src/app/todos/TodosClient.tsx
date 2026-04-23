"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Todo } from "./page";

export default function TodosClient({ initial }: { initial: Todo[] }) {
  const router = useRouter();
  const [todos, setTodos] = useState<Todo[]>(initial);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    const res = await fetch("/api/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: t, due_date: due || null }),
    });
    const json = await res.json();
    setBusy(false);
    if (json.ok) {
      setTodos([json.todo, ...todos]);
      setTitle("");
      setDue("");
      router.refresh();
    }
  }

  async function toggle(t: Todo) {
    const next = t.status === "done" ? "pending" : "done";
    setTodos(todos.map((x) => (x.id === t.id ? { ...x, status: next } : x)));
    await fetch(`/api/todos/${t.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    router.refresh();
  }

  async function del(t: Todo) {
    setTodos(todos.filter((x) => x.id !== t.id));
    await fetch(`/api/todos/${t.id}`, { method: "DELETE" });
    router.refresh();
  }

  const pending = todos.filter((t) => t.status === "pending");
  const done = todos.filter((t) => t.status === "done");

  return (
    <div>
      <form onSubmit={add} className="card mb-5 flex flex-col gap-2 p-4 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-subtle)]">
            New task
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Call Durham Democratic Committee"
            className="input"
          />
        </label>
        <label className="flex flex-col gap-1 sm:w-44">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-subtle)]">
            Due (optional)
          </span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="input" />
        </label>
        <button type="submit" disabled={busy || !title.trim()} className="btn-primary">
          Add
        </button>
      </form>

      {pending.length === 0 && done.length === 0 ? (
        <div className="card p-5 text-sm text-[var(--color-ink-subtle)]">
          Nothing on the list yet. Add one above.
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {pending.map((t) => (
              <Row key={t.id} t={t} onToggle={toggle} onDelete={del} />
            ))}
          </ul>
          {done.length > 0 && (
            <details className="mt-6">
              <summary className="section-label cursor-pointer hover:text-[var(--color-primary)]">
                Done ({done.length})
              </summary>
              <ul className="mt-3 space-y-2">
                {done.map((t) => (
                  <Row key={t.id} t={t} onToggle={toggle} onDelete={del} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function Row({
  t,
  onToggle,
  onDelete,
}: {
  t: Todo;
  onToggle: (t: Todo) => void;
  onDelete: (t: Todo) => void;
}) {
  const overdue =
    t.status === "pending" && t.due_date && new Date(t.due_date) < new Date(new Date().toDateString());
  return (
    <li className="card flex items-center gap-3 px-3 py-2">
      <input
        type="checkbox"
        checked={t.status === "done"}
        onChange={() => onToggle(t)}
        className="h-4 w-4 accent-[var(--color-primary)]"
      />
      <div className="flex-1">
        <div className={t.status === "done" ? "text-sm text-[var(--color-ink-subtle)] line-through" : "text-sm"}>
          {t.title}
        </div>
        {t.due_date && (
          <div
            className={`text-xs ${overdue ? "text-[var(--color-danger)]" : "text-[var(--color-ink-subtle)]"}`}
          >
            due {new Date(t.due_date).toLocaleDateString()}{overdue ? " · overdue" : ""}
          </div>
        )}
      </div>
      <button onClick={() => onDelete(t)} className="btn-ghost text-xs">
        Delete
      </button>
    </li>
  );
}
