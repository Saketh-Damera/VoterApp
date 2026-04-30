// Structured JSON logger. One line per event, parseable by Vercel log
// drains, Logtail, Datadog, etc. Each log carries a request_id so traces
// across functions stay correlated.

type Level = "debug" | "info" | "warn" | "error";

type Ctx = Record<string, unknown>;

const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: Level =
  (process.env.LOG_LEVEL as Level | undefined) ??
  (process.env.NODE_ENV === "production" ? "info" : "debug");

function emit(level: Level, msg: string, ctx?: Ctx) {
  if (LEVEL_RANK[level] < LEVEL_RANK[MIN_LEVEL]) return;
  const line = {
    level,
    ts: new Date().toISOString(),
    msg,
    ...(ctx ?? {}),
  };
  // stdout/stderr split so Vercel keeps the right severity
  const out = level === "error" || level === "warn" ? console.error : console.log;
  try {
    out(JSON.stringify(line));
  } catch {
    // Last-resort fallback if ctx contains an unserializable value.
    out(`[log-emit-fallback] ${level} ${msg}`);
  }
}

export const log = {
  debug: (msg: string, ctx?: Ctx) => emit("debug", msg, ctx),
  info: (msg: string, ctx?: Ctx) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: Ctx) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: Ctx) => emit("error", msg, ctx),
};

// Returns a logger pre-bound to a request context. Every call automatically
// includes request_id, route, and user_id when available.
export type RequestLogger = {
  debug: (msg: string, ctx?: Ctx) => void;
  info: (msg: string, ctx?: Ctx) => void;
  warn: (msg: string, ctx?: Ctx) => void;
  error: (msg: string, ctx?: Ctx) => void;
};

export function makeRequestLogger(base: Ctx): RequestLogger {
  return {
    debug: (msg, ctx) => log.debug(msg, { ...base, ...(ctx ?? {}) }),
    info: (msg, ctx) => log.info(msg, { ...base, ...(ctx ?? {}) }),
    warn: (msg, ctx) => log.warn(msg, { ...base, ...(ctx ?? {}) }),
    error: (msg, ctx) => log.error(msg, { ...base, ...(ctx ?? {}) }),
  };
}

export function newRequestId(): string {
  // crypto.randomUUID is available in Node 19+ and the browser; safe in the
  // Next runtime we declare ("nodejs").
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
