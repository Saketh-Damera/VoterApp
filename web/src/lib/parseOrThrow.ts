import { z } from "zod";
import { ValidationError } from "@/domain/errors";

// Validate any incoming JSON body against a Zod schema. Throws
// ValidationError with field-level messages on failure. Use at every API
// route boundary; the route's catch translates to a 400 via errorToResponse.
export function parseOrThrow<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".") || "_";
    fields[path] = issue.message;
  }
  throw new ValidationError("invalid request body", fields);
}

// Same idea but for query string parameters off URL.searchParams.
export function parseQuery<T>(schema: z.ZodType<T>, params: URLSearchParams): T {
  const obj: Record<string, string> = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return parseOrThrow(schema, obj);
}
