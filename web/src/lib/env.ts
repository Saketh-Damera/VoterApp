// Boot-time check that required server env vars are present. Throwing here
// surfaces a missing key as a clear startup error instead of a confusing
// 502 inside an API handler. The "warn-only" set is for vars that are
// nice-to-have but degrade gracefully.

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "ANTHROPIC_API_KEY",
] as const;

const OPTIONAL_ANY_OF: ReadonlyArray<readonly string[]> = [
  // Whisper transcription accepts either name.
  ["OPENAI_API_KEY", "OpenAI_Whisper"],
];

export function assertEnv() {
  const missing: string[] = [];
  for (const k of REQUIRED) {
    if (!process.env[k]) missing.push(k);
  }
  for (const group of OPTIONAL_ANY_OF) {
    if (!group.some((k) => !!process.env[k])) {
      missing.push(group.join(" or "));
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars: ${missing.join(", ")}. Set them in web/.env.local and Vercel.`,
    );
  }
}

// Run once at module load. Catches misconfiguration during dev / build /
// cold-start of any Node-runtime route.
assertEnv();
