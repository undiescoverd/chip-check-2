import "server-only";
import { serverEnv } from "@/lib/env";
import { ApiError } from "@/lib/server/errors";
import { readCookie, secureEquals } from "@/lib/server/http";
import { STAFF_COOKIE_NAME, verifyStaffCookie } from "@/lib/server/staffCookie";

/**
 * Staff authorisation (§7.2 step 6).
 *
 * Phase 1 authorised this route with an `X-Dev-Staff-Token` header equal to
 * `STAFF_SESSION_SECRET` — a deliberate, fenced hole, recorded as deviation 11 and
 * removed here as Phase 2 task 4 requires. Nothing accepts that header any more.
 *
 * Verification is pure crypto against the signed cookie, so this adds no Firestore round
 * trip to the order write path (§11's < 1.5 s target). The shop scope comes from the
 * signed payload rather than a lookup: a `cc_staff` minted for shop A cannot be replayed
 * against shop B, because `shopId` is inside the signature.
 *
 * Every failure is the same 401 `unauthorized` with no detail — which attempt failed and
 * why is not the caller's business, and the console's response is identical in all cases
 * (re-show the PIN gate).
 */
export function requireStaff(req: Request, shopId: string): void {
  const result = verifyStaffCookie(readCookie(req, STAFF_COOKIE_NAME));

  if (!result.ok) throw new ApiError(401, "unauthorized");
  if (result.payload.shopId !== shopId) throw new ApiError(401, "unauthorized");
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
