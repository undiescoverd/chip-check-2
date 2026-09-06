import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerEnvCache } from "@/lib/env";
import {
  STAFF_COOKIE_MAX_AGE_SECONDS,
  signStaffCookie,
  staffCookieOptions,
  verifyStaffCookie,
} from "@/lib/server/staffCookie";

const SECRET = "s".repeat(48);
const NOW = 1_700_000_000_000;

function env(secret = SECRET, nodeEnv = "test") {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", "e30=");
  vi.stubEnv("STAFF_SESSION_SECRET", secret);
  vi.stubEnv("CRON_SECRET", "c".repeat(32));
  resetServerEnvCache();
}

beforeEach(() => env());
afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
});

describe("signStaffCookie", () => {
  it("produces §7.2's two-part format", () => {
    const value = signStaffCookie("shop1", NOW);
    const [payload, sig] = value.split(".");
    expect(value.split(".")).toHaveLength(2);
    expect(payload).toBeTruthy();
    expect(sig).toBeTruthy();

    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    expect(decoded).toEqual({
      shopId: "shop1",
      role: "staff",
      iat: NOW / 1000,
      exp: NOW / 1000 + STAFF_COOKIE_MAX_AGE_SECONDS,
    });
  });

  it("expires 12 hours out", () => {
    expect(STAFF_COOKIE_MAX_AGE_SECONDS).toBe(43200);
  });

  it("never embeds the signing secret", () => {
    expect(signStaffCookie("shop1", NOW)).not.toContain(SECRET);
  });
});

describe("verifyStaffCookie", () => {
  it("round-trips a freshly signed cookie", () => {
    const result = verifyStaffCookie(signStaffCookie("shop1", NOW), NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.shopId).toBe("shop1");
  });

  it.each([
    [undefined, "missing"],
    [null, "null"],
    ["", "empty"],
    ["nodot", "no separator"],
    [".onlysig", "empty payload"],
    ["onlypayload.", "empty signature"],
  ])("rejects %s as malformed (%s)", (value: string | null | undefined, _why: string) => {
    const result = verifyStaffCookie(value, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed");
  });

  it("rejects a tampered payload", () => {
    // The whole point: flip the shop id and the signature no longer matches.
    const [, sig] = signStaffCookie("shop1", NOW).split(".");
    const forged = Buffer.from(
      JSON.stringify({ shopId: "shop2", role: "staff", iat: NOW / 1000, exp: NOW / 1000 + 43200 }),
      "utf8",
    ).toString("base64url");

    const result = verifyStaffCookie(`${forged}.${sig}`, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_signature");
  });

  it("rejects a tampered signature", () => {
    const [payload] = signStaffCookie("shop1", NOW).split(".");
    const result = verifyStaffCookie(`${payload}.${"A".repeat(43)}`, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_signature");
  });

  it("rejects a cookie signed with a different secret", () => {
    const value = signStaffCookie("shop1", NOW);
    env("d".repeat(48));
    const result = verifyStaffCookie(value, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("bad_signature");
  });

  it("expires exactly at exp, not after it", () => {
    const value = signStaffCookie("shop1", NOW);
    const expMs = NOW + STAFF_COOKIE_MAX_AGE_SECONDS * 1000;

    expect(verifyStaffCookie(value, expMs - 1).ok).toBe(true);

    const atExp = verifyStaffCookie(value, expMs);
    expect(atExp.ok).toBe(false);
    if (!atExp.ok) expect(atExp.reason).toBe("expired");
  });

  it("is still valid 11 hours in and dead at 13", () => {
    const value = signStaffCookie("shop1", NOW);
    expect(verifyStaffCookie(value, NOW + 11 * 3600_000).ok).toBe(true);
    expect(verifyStaffCookie(value, NOW + 13 * 3600_000).ok).toBe(false);
  });

  it("carries the shop scope in the signature, so shop A's cookie is not shop B's", () => {
    // §7.2 step 6 and the Phase 2 DoD. The caller compares payload.shopId; what matters
    // here is that the two cookies are genuinely different and neither can be edited
    // into the other (covered by the tamper case above).
    const a = verifyStaffCookie(signStaffCookie("shopA", NOW), NOW);
    const b = verifyStaffCookie(signStaffCookie("shopB", NOW), NOW);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.payload.shopId).toBe("shopA");
      expect(b.payload.shopId).toBe("shopB");
    }
  });

  it("rejects a well-signed payload that is not a staff cookie", () => {
    // Signed with our own secret but claiming another role — must not be accepted.
    const { createHmac } = require("node:crypto") as typeof import("node:crypto");
    const payload = Buffer.from(
      JSON.stringify({ shopId: "shop1", role: "owner", iat: NOW / 1000, exp: NOW / 1000 + 43200 }),
      "utf8",
    ).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");

    const result = verifyStaffCookie(`${payload}.${sig}`, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed");
  });
});

describe("staffCookieOptions", () => {
  it("matches §7.2's attributes", () => {
    const opts = staffCookieOptions();
    expect(opts).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 43200,
    });
  });

  it("sets Secure in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(staffCookieOptions().secure).toBe(true);
  });
});
