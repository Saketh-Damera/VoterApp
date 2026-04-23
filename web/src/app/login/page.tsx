"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

export default function LoginPage() {
  const router = useRouter();
  const supabase = getSupabaseBrowser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fn =
      mode === "signin"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({ email, password });
    const { error } = await fn;
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <div className="card p-6">
        <h1 className="mb-1 text-xl font-semibold tracking-tight text-[var(--color-primary)]">
          Voter Notebook
        </h1>
        <p className="mb-6 text-sm text-[var(--color-ink-subtle)]">
          {mode === "signin" ? "Sign in to your campaign." : "Create your campaign account."}
        </p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="email"
            required
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
          />
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? "…" : mode === "signin" ? "Sign in" : "Sign up"}
          </button>
          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
        </form>
        <button
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-5 text-sm text-[var(--color-ink-subtle)] hover:text-[var(--color-primary)]"
        >
          {mode === "signin" ? "Need an account? Sign up" : "Have one? Sign in"}
        </button>
      </div>
    </main>
  );
}
