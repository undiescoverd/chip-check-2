import { NextResponse } from "next/server";
import { UnlockBody } from "@/lib/schemas/shops";
import { adminDb } from "@/lib/server/admin";
import { ApiError, apiHandler } from "@/lib/server/errors";
import { clientIp, parseBody } from "@/lib/server/http";
import { verifyPin } from "@/lib/server/pin";
import {
  assertNotLockedOut,
  clearAttempts,
  recordFailedAttempt,
} from "@/lib/server/pinAttempts";
import { getPinHash } from "@/lib/server/shopAdmin";
import { shopRef } from "@/lib/server/shops";
import {
  STAFF_COOKIE_MAX_AGE_SECONDS,
  STAFF_COOKIE_NAME,
  signStaffCookie,
  staffCookieOptions,
} from "@/lib/server/staffCookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Context {
  params: { shopId: string };
}

/**
 * The segment is named `[shopId]` but §13 addresses this endpoint by **slug** — the
 * tablet is sitting on `/{slug}/staff` and has no id.
 *
 * The name is not a mistake and cannot be fixed by renaming: Next.js allows only one
 * dynamic segment name per position, and `app/api/shops/[shopId]/orders` already claims
 * it. Recorded in PROGRESS.md.
 *
 * Resolved as a slug first, then as a shop id. The fallback is not laziness — the seed
 * script gives the test shop the same value for both, and a real shop's auto-id would
 * otherwise be unusable here.
 */
async function resolveShopId(param: string): Promise<string> {
  const bySlug = await adminDb().collection("slugs").doc(param).get();
  const shopId = bySlug.exists ? bySlug.data()?.shopId : undefined;
  if (typeof shopId === "string" && shopId) return shopId;

  if ((await shopRef(param).get()).exists) return param;

  throw new ApiError(404, "shop_not_found");
}

/**
 * Exchange a PIN for the `cc_staff` cookie (§7.2).
 *
 * Order of operations is load-bearing: the lockout is checked **before** the PIN is
 * hashed. scrypt at N=2^15 costs ~110 ms, so hashing first would hand an attacker five
 * free CPU-bound operations per window and turn this endpoint into the cheapest way to
 * exhaust a serverless instance.
 */
export const POST = apiHandler<Context>(async (req, { params }) => {
  const shopId = await resolveShopId(params.shopId);
  const ip = clientIp(req);

  await assertNotLockedOut(shopId, ip);

  const { pin } = await parseBody(req, UnlockBody);

  const stored = await getPinHash(shopId);
  // A shop with no PIN set refuses every unlock. v1 did the opposite — a missing secret
  // meant every request was accepted — and that is the defect this phase exists to
  // prevent, so the missing case gets the same treatment as a wrong PIN, including the
  // attempt counter.
  const ok = stored !== null && (await verifyPin(pin, stored));

  if (!ok) {
    await recordFailedAttempt(shopId, ip);
    throw new ApiError(401, "invalid_pin");
  }

  await clearAttempts(shopId, ip);

  const now = Date.now();
  const res = NextResponse.json({
    ok: true,
    expiresAt: now + STAFF_COOKIE_MAX_AGE_SECONDS * 1000,
  });
  res.cookies.set(STAFF_COOKIE_NAME, signStaffCookie(shopId, now), staffCookieOptions());
  return res;
});

/**
 * "Change PIN" on the console (§7.2 step 7) — clears the cookie and sends the tablet
 * back to the gate. The copy says "Change PIN" for v1 parity; it means "re-enter".
 */
export const DELETE = apiHandler<Context>(async () => {
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(STAFF_COOKIE_NAME, "", { ...staffCookieOptions(0), maxAge: 0 });
  return res;
});
