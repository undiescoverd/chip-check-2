import { NextResponse } from "next/server";

/**
 * Error contract (§14). Every handler returns JSON; every error is
 * `{ error: <stable code>, ...details }`. The codes are the client's mapping keys
 * (§23), so they are part of the API and must not be reworded.
 *
 * HTTP status by class: 400 validation, 401 unauthenticated, 402 unentitled,
 * 403 wrong owner, 404 missing, 409 conflict, 429 rate-limited, 500 unexpected,
 * 503 feature disabled.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export function apiError(error: ApiError): NextResponse {
  return NextResponse.json({ error: error.code, ...error.details }, { status: error.status });
}

type Handler<C> = (req: Request, context: C) => Promise<NextResponse> | NextResponse;

/**
 * Wraps a route handler: thrown `ApiError`s become their declared response, and anything
 * else becomes a 500 carrying only a request id.
 *
 * v1 leaked HTML error pages and stack traces. Nothing but the code and its declared
 * details reaches the client — no stack, no Firestore message (§14). The detail goes to
 * the server log under the same request id so a report of "I got 500 abc123" is
 * traceable.
 */
export function apiHandler<C>(fn: Handler<C>) {
  return async (req: Request, context: C): Promise<NextResponse> => {
    try {
      return await fn(req, context);
    } catch (err) {
      if (err instanceof ApiError) return apiError(err);

      const requestId = crypto.randomUUID();
      console.error(`[${requestId}] unhandled error in ${req.method} ${req.url}`, err);
      return NextResponse.json({ error: "internal", requestId }, { status: 500 });
    }
  };
}
