"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import JedLogo from "@/components/JedLogo";

type Result = "ok" | "confirm_email" | { error: string };

export default function LoginPage() {
  // useSearchParams forces this page out of static prerender; wrapping it in
  // Suspense lets Next.js 16 still build cleanly.
  return (
    <Suspense fallback={<LoginShell />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginShell() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <div className="card p-6">
        <div className="mb-3 flex justify-center">
          <JedLogo size="lg" href="" />
        </div>
        <p className="text-center text-sm text-[var(--color-ink-subtle)]">Loading...</p>
      </div>
    </main>
  );
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = getSupabaseBrowser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // Surface errors that bounced back from /auth/callback
  useEffect(() => {
    const e = searchParams.get("auth_error");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (e) setResult({ error: friendlyAuthError(e, "signin") });
  }, [searchParams]);

  async function startDemo() {
    if (loading) return;
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error || !data.session) {
        setResult({
          error:
            "Demo mode needs Anonymous auth enabled in Supabase. " +
            "Open Authentication → Providers → scroll to Anonymous → toggle on. Then try again.",
        });
        return;
      }
      await supabase.rpc("seed_demo");
      router.push("/");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setResult(null);
    try {
      if (mode === "signin") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setResult({ error: friendlyAuthError(error.message, mode) });
          return;
        }
        if (data.session) {
          router.push("/");
          router.refresh();
        } else {
          setResult({ error: "Signed in but no session returned. Try again." });
        }
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) {
          setResult({ error: friendlyAuthError(error.message, mode) });
          return;
        }
        // With email confirmation ON, signUp returns a user but no session.
        // With email confirmation OFF, signUp returns a session immediately.
        if (data.session) {
          router.push("/");
          router.refresh();
        } else {
          setResult("confirm_email");
        }
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <div className="card p-6">
        <div className="mb-3 flex justify-center">
          <JedLogo size="lg" href="" />
        </div>
        <p className="mb-6 text-center text-xs uppercase tracking-[0.15em] text-[var(--color-ink-subtle)]">
          Voter Intelligence Notebook
        </p>
        <p className="mb-5 text-sm text-[var(--color-ink-subtle)]">
          {mode === "signin" ? "Sign in to your campaign." : "Create your campaign account."}
        </p>

        {result === "confirm_email" && (
          <div className="mb-4 rounded-md border border-[var(--color-accent-soft)] bg-[var(--color-accent-soft)] p-3 text-sm">
            <strong className="text-[var(--color-primary)]">Almost there.</strong> Check your inbox at{" "}
            <span className="font-mono">{email}</span> for a confirmation link, then return here to sign in.
            Emails from Supabase sometimes land in Spam.
          </div>
        )}

        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="email"
            required
            placeholder="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
            disabled={loading}
            autoComplete="email"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="password (min 6)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
            disabled={loading}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />
          <button type="submit" disabled={loading} className="btn-primary">
            {loading
              ? (mode === "signin" ? "Signing in..." : "Creating account...")
              : (mode === "signin" ? "Sign in" : "Sign up")}
          </button>
          {result && typeof result === "object" && "error" in result && (
            <p className="text-sm text-[var(--color-danger)]">{result.error}</p>
          )}
        </form>
        <button
          onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setResult(null); }}
          className="mt-5 text-sm text-[var(--color-ink-subtle)] hover:text-[var(--color-primary)]"
          disabled={loading}
        >
          {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>

        <hr className="my-5 border-[var(--color-border)]" />
        <div className="text-center">
          <p className="mb-2 text-xs text-[var(--color-ink-subtle)]">
            Want to try JED without signing up?
          </p>
          <button
            onClick={startDemo}
            disabled={loading}
            className="btn-secondary w-full"
            type="button"
          >
            {loading ? "Starting demo..." : "Try the demo (NC Durham sample)"}
          </button>
          <p className="mt-2 text-[0.6875rem] text-[var(--color-ink-subtle)]">
            Spins up a disposable account pre-loaded with sample voters and interactions.
          </p>
        </div>
      </div>
    </main>
  );
}

function friendlyAuthError(message: string, mode: "signin" | "signup"): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "Email or password didn't match. If you just signed up, check your inbox for the confirmation link first.";
  }
  if (m.includes("email not confirmed")) {
    return "Please confirm your email before signing in — check your inbox.";
  }
  if (m.includes("already registered") || m.includes("user already registered")) {
    return "That email is already registered. Switch to Sign in and try your password.";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (m.includes("password") && m.includes("short")) {
    return "Password must be at least 6 characters.";
  }
  if (m.includes("network") || m.includes("failed to fetch")) {
    return "Network error reaching the auth server. Check your connection and try again.";
  }
  return `${mode === "signin" ? "Sign in" : "Sign up"} failed: ${message}`;
}
