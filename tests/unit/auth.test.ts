import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerEnvCache } from "@/lib/env";
import { requireCron, requireStaff } from "@/lib/server/auth";
import { ApiError } from "@/lib/server/errors";
import { STAFF_COOKIE_NAME, signStaffCookie } from "@/lib/server/staffCookie";

const SECRET = "s".repeat(48);
const CRON = "c".repeat(32);

function env(nodeEnv = "test", secret = SECRET) {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", "e30=");
  vi.stubEnv("STAFF_SESSION_SECRET", secret);
  vi.stubEnv("CRON_SECRET", CRON);
  resetServerEnvCache();
}

function req(headers: Record<string, string> = {}) {
  return new Request("https://example.test/api/shops/shop1/orders", { headers });
}

function withCookie(value: string) {
  return req({ cookie: `${STAFF_COOKIE_NAME}=${value}` });
}

function expectUnauthorized(fn: () => void) {
  expect(fn).toThrow(ApiError);
  try {
    fn();
  } catch (err) {
    expect((err as ApiError).status).toBe(401);
    expect((err as ApiError).code).toBe("unauthorized");
  }
}

beforeEach(() => env());
afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
});

/**
 * §7.2 step 6. Phase 1's `X-Dev-Staff-Token` header is gone (deviation 11, discharged);
 * the first test here is the one that proves it stays gone.
 */
describe("requireStaff", () => {
  it("no longer accepts the Phase 1 dev header", () => {
    // The deliberate hole Phase 1 opened. If this ever passes again, the tenant boundary
    // is off — the header could not be shop-scoped, which is why it had to die.
    expectUnauthorized(() =>
      requireStaff(req({ "x-dev-staff-token": SECRET }), "shop1"),
    );
  });

  it("accepts a valid cookie for this shop", () => {
    expect(() => requireStaff(withCookie(signStaffCookie("shop1")), "shop1")).not.toThrow();
  });

  it("refuses a cookie minted for another shop", () => {
    // The Phase 2 Definition of Done: "a cookie for shop A is rejected on shop B (401)".
    expectUnauthorized(() => requireStaff(withCookie(signStaffCookie("shopA")), "shopB"));
  });

  it("refuses a missing cookie", () => {
    expectUnauthorized(() => requireStaff(req(), "shop1"));
  });

  it("refuses a garbage cookie", () => {
    expectUnauthorized(() => requireStaff(withCookie("not-a-cookie"), "shop1"));
  });

  it("refuses a cookie signed with a different secret", () => {
    const foreign = signStaffCookie("shop1");
    env("test", "d".repeat(48));
    expectUnauthorized(() => requireStaff(withCookie(foreign), "shop1"));
  });

  it("refuses an expired cookie", () => {
    const stale = signStaffCookie("shop1", Date.now() - 13 * 3600_000);
    expectUnauthorized(() => requireStaff(withCookie(stale), "shop1"));
  });

  it("picks the cookie out from among others", () => {
    const value = signStaffCookie("shop1");
    const request = req({ cookie: `other=1; ${STAFF_COOKIE_NAME}=${value}; another=2` });
    expect(() => requireStaff(request, "shop1")).not.toThrow();
  });

  it("fails closed when STAFF_SESSION_SECRET is missing entirely", () => {
    // v1's headline defect was an auth check that passed when its env var was unset.
    // Here it must throw rather than admit anyone.
    const value = signStaffCookie("shop1");
    vi.stubEnv("STAFF_SESSION_SECRET", "");
    resetServerEnvCache();
    expect(() => requireStaff(withCookie(value), "shop1")).toThrow();
  });

  it("is enforced in production too — there is no environment that skips it", () => {
    env("production");
    expectUnauthorized(() => requireStaff(req(), "shop1"));
    expect(() =>
      requireStaff(withCookie(signStaffCookie("shop1")), "shop1"),
    ).not.toThrow();
  });
});

describe("requireCron", () => {
  it("accepts the bearer token", () => {
    env("production");
    expect(() => requireCron(req({ authorization: `Bearer ${CRON}` }))).not.toThrow();
  });

  it("refuses a missing header", () => {
    env("production");
    expect(() => requireCron(req())).toThrow(ApiError);
  });

  it("refuses a wrong secret", () => {
    env("production");
    expect(() => requireCron(req({ authorization: "Bearer nope" }))).toThrow(ApiError);
  });

  it("refuses the bare secret without the Bearer prefix", () => {
    env("production");
    expect(() => requireCron(req({ authorization: CRON }))).toThrow(ApiError);
  });

  it("reports 401, not 403 — the caller is unauthenticated, not forbidden", () => {
    env("production");
    try {
      requireCron(req());
    } catch (err) {
      expect((err as ApiError).status).toBe(401);
    }
  });
});
