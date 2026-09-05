import "server-only";
import { serverEnv } from "@/lib/env";
import { ApiError } from "@/lib/server/errors";
import { secureEquals } from "@/lib/server/http";

/**
 * ============================================================================
 * TEMPORARY — PHASE 1 ONLY. DELETE IN PHASE 2.
 * ============================================================================
 *
 * Phase 2 builds the real staff auth: a shop PIN exchanged for a signed HttpOnly
 * `cc_staff` cookie, scoped to one shop for 12 h (§7.2). None of that exists yet, but
 * Phase 1's orders route has to be callable to be testable, so Part H task 2 authorises
 * it with a header carrying `STAFF_SESSION_SECRET`.
 *
 * This is a deliberate hole and it is fenced accordingly:
 *   - it is inert whenever NODE_ENV === "production" — the check below runs first and
 *     throws, so a production deploy refuses every request rather than accepting the
 *     header;
 *   - the comparison is constant-time;
 *   - it is not shop-scoped, which is exactly why it cannot survive into Phase 2.
 *
 * `tests/unit/auth.test.ts` asserts the production refusal. Recorded in PROGRESS.md
 * under Deviations. Phase 2 task 4 removes this file's contents and wires `requireStaff`
 * to the cookie.
 */
const DEV_STAFF_HEADER = "x-dev-staff-token";

export function requireStaff(req: Request, shopId: string): void {
  // Phase 2 scopes the cookie to shopId; the dev header deliberately cannot be scoped,
  // which is part of why it must not outlive this phase.
  void shopId;

  if (process.env.NODE_ENV === "production") {
    throw new ApiError(401, "unauthorized");
  }

  const provided = req.headers.get(DEV_STAFF_HEADER);
  if (!provided) throw new ApiError(401, "unauthorized");

  if (!secureEquals(provided, serverEnv().STAFF_SESSION_SECRET)) {
    throw new ApiError(401, "unauthorized");
  }
}

/**
 * Cron authentication (§13.1). Vercel invokes crons with GET and
 * `Authorization: Bearer <CRON_SECRET>`; anything else is refused.
 */
export function requireCron(req: Request): void {
  const provided = req.headers.get("authorization");
  if (!provided) throw new ApiError(401, "unauthorized");

  if (!secureEquals(provided, `Bearer ${serverEnv().CRON_SECRET}`)) {
    throw new ApiError(401, "unauthorized");
  }
}
