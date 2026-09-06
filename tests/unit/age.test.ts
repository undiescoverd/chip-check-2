import { describe, expect, it } from "vitest";
import { ageMs, formatAge, isOverTarget } from "@/lib/orders/age";
import type { Order } from "@/lib/types";

/**
 * §22.2's order age. The rules are small; the two that matter are the ones that stop the
 * element being *wrong* rather than merely ugly: a null `createdAt` (an unresolved
 * `serverTimestamp()`) must not render as 55 years, and a device clock that is a few
 * seconds ahead of Firestore must not render a negative age.
 */

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: "o1",
    orderNumber: "0042",
    status: "preparing",
    createdAt: NOW,
    readyAt: null,
    cleared: false,
    clearedAt: null,
    clearedBy: null,
    ...overrides,
  };
}

describe("ageMs", () => {
  it("measures from createdAt", () => {
    expect(ageMs(order({ createdAt: NOW - 7 * MINUTE }), NOW)).toBe(7 * MINUTE);
  });

  it("treats an unresolved createdAt as brand new", () => {
    expect(ageMs(order({ createdAt: null }), NOW)).toBe(0);
  });

  it("clamps a future createdAt to zero rather than going negative", () => {
    expect(ageMs(order({ createdAt: NOW + 5_000 }), NOW)).toBe(0);
  });

  it("keeps counting after the order goes ready", () => {
    // The customer's wait does not stop when the fryer's does.
    const ready = order({ status: "ready", createdAt: NOW - 20 * MINUTE, readyAt: NOW - MINUTE });
    expect(ageMs(ready, NOW)).toBe(20 * MINUTE);
  });
});

describe("formatAge", () => {
  it("shows whole minutes under an hour", () => {
    expect(formatAge(0)).toBe("0m");
    expect(formatAge(59_999)).toBe("0m");
    expect(formatAge(MINUTE)).toBe("1m");
    expect(formatAge(59 * MINUTE)).toBe("59m");
  });

  it("shows hours and minutes above an hour", () => {
    expect(formatAge(60 * MINUTE)).toBe("1h 0m");
    expect(formatAge(95 * MINUTE)).toBe("1h 35m");
    expect(formatAge(7 * 60 * MINUTE)).toBe("7h 0m");
  });
});

describe("isOverTarget", () => {
  const target = 480; // §9's default targetPrepSeconds

  it("is false below the target", () => {
    expect(isOverTarget(order({ createdAt: NOW - 7 * MINUTE }), target, NOW)).toBe(false);
  });

  it("escalates exactly at the target", () => {
    expect(isOverTarget(order({ createdAt: NOW - 8 * MINUTE }), target, NOW)).toBe(true);
  });

  it("never escalates an order whose createdAt has not resolved", () => {
    expect(isOverTarget(order({ createdAt: null }), target, NOW)).toBe(false);
  });
});
