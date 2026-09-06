import "server-only";
import type { DecodedIdToken } from "firebase-admin/auth";
import { superadminUids } from "@/lib/env";
import { adminAuth } from "@/lib/server/admin";
import { ApiError } from "@/lib/server/errors";
import { readCookie } from "@/lib/server/http";
import { getShop } from "@/lib/server/shops";
import type { Shop } from "@/lib/types";

/**
 * Owner sessions (§7.1).
 *
 * The cookie is the session, not the Firebase client SDK's state. The browser signs out
 * of the client SDK immediately after the exchange, so there is exactly one source of
 * truth and Firestore client reads stay anonymous — which is what lets `firestore.rules`
 * avoid `request.auth` entirely (§10).
 *
 * The decision logic here is separated from the Admin SDK calls so the policy can be
 * unit-tested without Firebase, in the same way `lib/orders/rules.ts` is separate from
 * `lib/server/orders.ts`.
 */

export const SESSION_COOKIE_NAME = "cc_session";
/** 14 days, per §7.1 step 4 (`Max-Age=1209600`). */
export const SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;
/**
 * Firebase refuses `createSessionCookie` for an ID token whose `auth_time` is older than
 * five minutes. Checked explicitly so a stale token returns §13's `invalid_token` rather
 * than surfacing an opaque Admin SDK error as a 500.
 */
export const AUTH_TIME_MAX_AGE_MS = 5 * 60 * 1000;

export function isAuthTimeFresh(authTimeSeconds: unknown, nowMs: number): boolean {
  if (typeof authTimeSeconds !== "number" || !Number.isFinite(authTimeSeconds)) return false;
  const ageMs = nowMs - authTimeSeconds * 1000;
  // A small negative age is ordinary clock skew between us and Google; a large one is not.
  return ageMs <= AUTH_TIME_MAX_AGE_MS && ageMs >= -AUTH_TIME_MAX_AGE_MS;
}

export function sessionCookieOptions(maxAgeSeconds = SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    // Dropped outside production only so a local server over plain HTTP can hold the
    // cookie; Vercel is always HTTPS.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export interface CreatedSession {
  uid: string;
  cookie: string;
  email: string | null;
  displayName: string | null;
}

/**
 * Exchange a Google ID token for a session cookie (§7.1 steps 3–4).
 * Throws 401 `invalid_token` for anything the caller could have caused.
 */
export async function createSession(
  idToken: string,
  nowMs: number = Date.now(),
): Promise<CreatedSession> {
  const auth = adminAuth();

  let decoded: DecodedIdToken;
  try {
    decoded = await auth.verifyIdToken(idToken);
  } catch {
    // Never surface the Firebase message — it distinguishes "expired" from "malformed"
    // from "wrong project", none of which the caller needs (§14).
    throw new ApiError(401, "invalid_token");
  }

  if (!isAuthTimeFresh(decoded.auth_time, nowMs)) {
    throw new ApiError(401, "invalid_token");
  }

  let cookie: string;
  try {
    cookie = await auth.createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
    });
  } catch {
    throw new ApiError(401, "invalid_token");
  }

  return {
    uid: decoded.uid,
    cookie,
    email: typeof decoded.email === "string" ? decoded.email : null,
    displayName: typeof decoded.name === "string" ? decoded.name : null,
  };
}

/**
 * Verify a session cookie value. `checkRevoked` is on, which is what makes
 * `DELETE /api/auth/session`'s `revokeRefreshTokens` actually end a session (§7.1 step 7).
 */
export async function verifySession(value: string | undefined): Promise<DecodedIdToken> {
  if (!value) throw new ApiError(401, "unauthorized");
  try {
    return await adminAuth().verifySessionCookie(value, true);
  } catch {
    throw new ApiError(401, "unauthorized");
  }
}

export interface OwnerIdentity {
  uid: string;
  email: string | null;
}

function toIdentity(decoded: DecodedIdToken): OwnerIdentity {
  return {
    uid: decoded.uid,
    email: typeof decoded.email === "string" ? decoded.email : null,
  };
}

/** §13: verifies `cc_session`; returns `{ uid }` or throws 401. */
export async function requireOwner(req: Request): Promise<OwnerIdentity> {
  return toIdentity(await verifySession(readCookie(req, SESSION_COOKIE_NAME)));
}

/** The same, for server components, which read the cookie through `next/headers`. */
export async function requireOwnerFromCookie(
  value: string | undefined,
): Promise<OwnerIdentity> {
  return toIdentity(await verifySession(value));
}

/**
 * Pure ownership check (§6). Separated so the 401-vs-403 distinction is testable
 * without Firebase: an unauthenticated caller is 401, a signed-in caller who does not
 * own this shop is 403. Conflating the two is how a tenant boundary quietly becomes a
 * suggestion.
 */
export function assertOwns(shop: Shop, uid: string): void {
  if (shop.ownerUid !== uid) throw new ApiError(403, "forbidden");
}

export interface OwnerOfResult extends OwnerIdentity {
  shop: Shop;
}

/** §13: `requireOwner` + `shop.ownerUid === uid`, else 403. 404 if the shop is missing. */
export async function requireOwnerOf(req: Request, shopId: string): Promise<OwnerOfResult> {
  const identity = await requireOwner(req);
  const shop = await getShop(shopId);
  assertOwns(shop, identity.uid);
  return { ...identity, shop };
}

/** Pure superadmin check (§6), so the UID list logic is testable without Firebase. */
export function isSuperadmin(uid: string, allowed: string[]): boolean {
  return allowed.includes(uid);
}

/** §13: `requireOwner` + uid ∈ `SUPERADMIN_UIDS`, else 403. */
export async function requireSuperadmin(req: Request): Promise<OwnerIdentity> {
  const identity = await requireOwner(req);
  if (!isSuperadmin(identity.uid, superadminUids())) {
    throw new ApiError(403, "forbidden");
  }
  return identity;
}
