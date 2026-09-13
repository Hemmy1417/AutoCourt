/**
 * One typed error envelope for every route: {code, message, details}.
 * The same envelope carries the contract's verbatim refusal sentence when
 * a write is refused — the UI shows the reason in words, never a button
 * that silently fails (S40).
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) {
    return Response.json(
      { code: e.code, message: e.message, details: e.details ?? null },
      { status: e.status },
    );
  }
  console.error("[api] unhandled:", e);
  return Response.json(
    { code: "INTERNAL", message: "internal error", details: null },
    { status: 500 },
  );
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "BAD_REQUEST", message, details);
export const unauthorized = () =>
  new ApiError(401, "UNAUTHORIZED", "sign in to continue");
export const forbidden = (message = "not allowed on this record") =>
  new ApiError(403, "FORBIDDEN", message);
export const notFound = (what = "record") =>
  new ApiError(404, "NOT_FOUND", `${what} not found`);
export const conflict = (message: string) =>
  new ApiError(409, "CONFLICT", message);
export const tooMany = () =>
  new ApiError(429, "RATE_LIMITED", "too many requests — slow down");
