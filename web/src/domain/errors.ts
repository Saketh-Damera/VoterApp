// Domain error classes. Routes call errorToResponse() to translate any
// thrown error into a uniform HTTP response. New error types map to a
// status code in one place — no scattered if/else chains.

export class DomainError extends Error {
  // Each subclass overrides status. Default to 500 so an unexpected subclass
  // still produces a sane response rather than NaN.
  readonly status: number = 500;
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnauthorizedError extends DomainError {
  readonly status = 401;
}

export class ForbiddenError extends DomainError {
  readonly status = 403;
}

export class NotFoundError extends DomainError {
  readonly status = 404;
}

export class ConflictError extends DomainError {
  readonly status = 409;
}

export class ValidationError extends DomainError {
  readonly status = 400;
  constructor(
    message: string,
    public readonly fields?: Record<string, string>,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

export class RateLimitError extends DomainError {
  readonly status = 429;
  constructor(message: string, public readonly retryAfter: number) {
    super(message);
  }
}

export class ExternalServiceError extends DomainError {
  readonly status = 502;
  constructor(
    message: string,
    public readonly service: string,
    cause?: unknown,
  ) {
    super(message, cause);
  }
}

export class InternalError extends DomainError {
  readonly status = 500;
}

// Translate any thrown value into a JSON Response.
export function errorToResponse(e: unknown): Response {
  if (e instanceof DomainError) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (e instanceof RateLimitError) {
      headers["Retry-After"] = String(e.retryAfter);
    }
    const body: Record<string, unknown> = { error: e.message, code: e.name };
    if (e instanceof ValidationError && e.fields) body.fields = e.fields;
    return new Response(JSON.stringify(body), { status: e.status, headers });
  }
  // Unknown error — never leak the message to the client.
  return new Response(
    JSON.stringify({ error: "internal error", code: "InternalError" }),
    { status: 500, headers: { "content-type": "application/json" } },
  );
}
