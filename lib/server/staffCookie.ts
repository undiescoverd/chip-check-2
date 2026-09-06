import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * The staff cookie (§7.2 step 5).
 *
 *   cc_staff = base64url(payload) + "." + base64url(HMAC-SHA256(base64url(payload), secret))
 *   payload  = { shopId, role: "staff", iat, exp }   exp = iat + 12 h
 *
 * Deliberately not a Firestore lookup. Verification is pure crypto, so `requireStaff`
 * costs no round trip on the order write path — the same reasoning §14.1 gives for not
 * rate-limiting `markReady`/`recall`/`clear`. The shop scope is *in* the signature:
 * a cookie minted for shop A fails on shop B because `shopId` is part of the signed
 * payload, not because of a lookup that could be forgotten.
 *
 * The signature covers the encoded payload string, so the bytes verified are exactly
 * the bytes decoded — re-serialising JSON before checking would let a crafted
 * equivalent encoding through.
 */

export const STAFF_COOKIE_NAME = "cc_staff";
export const STAFF_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60; // 43200, §7.2

export interface StaffPayload {
  shopId: string;
  role: "staff";
  /** Seconds since the epoch, matching §7.2's `iat`/`exp`. */
  iat: number;
  exp: number;
}

export type StaffCookieResult =
  | { ok: true; payload: StaffPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(encodedPayload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(encodedPayload).digest());
}

export function signStaffCookie(shopId: string, nowMs: number = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const payload: StaffPayload = {
    shopId,
    role: "staff",
    iat,
    exp: iat + STAFF_COOKIE_MAX_AGE_SECONDS,
  };

  const encoded = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${encoded}.${sign(encoded, serverEnv().STAFF_SESSION_SECRET)}`;
}

export function verifyStaffCookie(
  value: string | undefined | null,
  nowMs: number = Date.now(),
): StaffCookieResult {
  if (!value) return { ok: false, reason: "malformed" };

  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return { ok: false, reason: "malformed" };

  const encoded = value.slice(0, dot);
  const provided = value.slice(dot + 1);

  const expected = sign(encoded, serverEnv().STAFF_SESSION_SECRET);

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Compare length first: timingSafeEqual throws on a mismatch, and the length of an
  // HMAC is not a secret, so there is nothing to leak by checking it.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: StaffPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (
    !payload ||
    typeof payload.shopId !== "string" ||
    !payload.shopId ||
    payload.role !== "staff" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (payload.exp * 1000 <= nowMs) return { ok: false, reason: "expired" };

  return { ok: true, payload };
}

/**
 * Cookie attributes (§7.2). `Secure` is dropped outside production only so the cookie
 * works over plain HTTP against a local server on the emulator — Vercel is always
 * HTTPS, so the deployed cookie is always Secure.
 */
export function staffCookieOptions(maxAgeSeconds = STAFF_COOKIE_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
