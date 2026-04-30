// Wrapped Anthropic SDK with retry + timeout + structured logging.
// Use callAnthropic / callAnthropicParse instead of constructing the client
// directly so every AI call has the same observability and reliability.

import Anthropic from "@anthropic-ai/sdk";
import { ExternalServiceError } from "@/domain/errors";
import { log } from "@/lib/logger";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;

const client = new Anthropic({ timeout: DEFAULT_TIMEOUT_MS, maxRetries: 0 });

// Determine if a thrown error from the SDK is worth retrying. Network
// errors, 5xx, 408, 429, and abort timeouts are retryable. 4xx other than
// 408/429 are not.
function isRetryable(e: unknown): boolean {
  if (e instanceof Anthropic.APIError) {
    const s = e.status;
    if (typeof s !== "number") return true; // network-level
    return s === 408 || s === 425 || s === 429 || s >= 500;
  }
  // Connection reset / ECONNREFUSED / fetch failure
  return true;
}

function backoffMs(attempt: number): number {
  const base = 250 * 2 ** attempt; // 250, 500, 1000
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const retry = isRetryable(e);
      log.warn("anthropic.call_failed", {
        label,
        attempt,
        retry,
        err: e instanceof Error ? e.message : String(e),
      });
      if (!retry || attempt === MAX_RETRIES - 1) break;
      await new Promise((r) => setTimeout(r, backoffMs(attempt)));
    }
  }
  throw new ExternalServiceError(
    `Anthropic call failed after ${MAX_RETRIES} attempts: ${label}`,
    "anthropic",
    lastErr,
  );
}

export const ai = {
  // Plain text completion (e.g., final answers from the agent loop).
  create: <P extends Anthropic.MessageCreateParamsNonStreaming>(
    label: string,
    params: P,
  ) => withRetry(label, () => client.messages.create(params)),

  // Structured-output (zodOutputFormat). Returns the parsed object.
  parse: <P extends Anthropic.MessageCreateParamsNonStreaming>(
    label: string,
    params: P,
  ) => withRetry(label, () => client.messages.parse(params)),
};

export { Anthropic };
