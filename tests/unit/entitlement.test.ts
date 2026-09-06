import { describe, expect, it } from "vitest";
import { PAST_DUE_GRACE_MS, isEntitled, resolveBillingEnabled } from "@/lib/orders/entitlement";
import type { Billing } from "@/lib/types";

const NOW = 1_700_000_000_000;
const shop = (isPilot = false) => ({ isPilot });
const billing = (b: Partial<Billing>): Billing => ({ status: "none", ...b });

describe("resolveBillingEnabled", () => {
  it("prefers the Firestore flag when it is set", () => {
    expect(resolveBillingEnabled(true, false)).toBe(true);
    expect(resolveBillingEnabled(false, true)).toBe(false);
  });

  it("falls back to the env var when the flag is absent", () => {
    expect(resolveBillingEnabled(undefined, true)).toBe(true);
    expect(resolveBillingEnabled(null, false)).toBe(false);
  });
});

describe("isEntitled", () => {
  it("entitles everyone while billing is off — the pilot default", () => {
    expect(isEntitled(false, shop(), null, NOW).ok).toBe(true);
    expect(isEntitled(false, shop(), billing({ status: "canceled" }), NOW).ok).toBe(true);
  });

  it("entitles a pilot shop regardless of billing status", () => {
    expect(isEntitled(true, shop(true), billing({ status: "canceled" }), NOW).ok).toBe(true);
  });

  it.each(["trialing", "active", "pilot"] as const)("entitles a %s subscription", (status) => {
    expect(isEntitled(true, shop(), billing({ status }), NOW).ok).toBe(true);
  });

  it("keeps a past_due shop serving inside the grace period", () => {
    const b = billing({ status: "past_due", pastDueSince: NOW - PAST_DUE_GRACE_MS + 1_000 });
    expect(isEntitled(true, shop(), b, NOW).ok).toBe(true);
  });

  it("cuts off a past_due shop once grace has run out", () => {
    const b = billing({ status: "past_due", pastDueSince: NOW - PAST_DUE_GRACE_MS });
    expect(isEntitled(true, shop(), b, NOW)).toEqual({
      ok: false,
      code: "subscription_required",
      status: "past_due",
    });
  });

  it("cuts off past_due with no pastDueSince rather than granting open-ended grace", () => {
    expect(isEntitled(true, shop(), billing({ status: "past_due" }), NOW).ok).toBe(false);
  });

  it.each(["canceled", "none"] as const)("refuses a %s shop", (status) => {
    const result = isEntitled(true, shop(), billing({ status }), NOW);
    expect(result).toEqual({ ok: false, code: "subscription_required", status });
  });

  it("refuses a shop with no billing document at all", () => {
    expect(isEntitled(true, shop(), null, NOW)).toEqual({
      ok: false,
      code: "subscription_required",
      status: "none",
    });
  });

  it("uses a seven-day grace period", () => {
    expect(PAST_DUE_GRACE_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
