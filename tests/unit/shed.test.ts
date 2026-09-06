import { describe, expect, it } from "vitest";
import { shouldClearAll } from "@/lib/orders/rules";
import { shedCount, shedFilters, shedMinutes, shedOrders } from "@/lib/orders/shed";
import type { Order } from "@/lib/types";

/**
 * §22.2's shed nudge. The assertion that carries the feature is the last one: the count
 * on the button and the set the request clears are produced by the same rule, so the
 * nudge cannot say "3" and then clear 4.
 */

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const TIMEOUT = 300; // §9's default readyTimeoutSeconds — five minutes

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: Math.random().toString(36).slice(2),
    orderNumber: "0042",
    status: "preparing",
    createdAt: NOW - 30 * MINUTE,
    readyAt: null,
    cleared: false,
    clearedAt: null,
    clearedBy: null,
    ...overrides,
  };
}

const staleReady = () => order({ status: "ready", readyAt: NOW - 6 * MINUTE });
const freshReady = () => order({ status: "ready", readyAt: NOW - MINUTE });

describe("shedCount", () => {
  it("counts only ready orders past the timeout", () => {
    const orders = [staleReady(), freshReady(), order(), staleReady()];
    expect(shedCount(orders, TIMEOUT, NOW)).toBe(2);
  });

  it("never counts a preparing order, however old", () => {
    // Preparing orders are the purge's business, never the nudge's (§13.1).
    const ancient = order({ createdAt: NOW - 5 * 60 * MINUTE });
    expect(shedCount([ancient], TIMEOUT, NOW)).toBe(0);
  });

  it("is zero on an empty board", () => {
    expect(shedCount([], TIMEOUT, NOW)).toBe(0);
  });

  it("measures from readyAt, not createdAt", () => {
    // An order taken an hour ago but marked ready ten seconds ago is not stale.
    const justReady = order({ status: "ready", createdAt: NOW - 60 * MINUTE, readyAt: NOW - 10_000 });
    expect(shedCount([justReady], TIMEOUT, NOW)).toBe(0);
  });

  it("follows the shop's own timeout", () => {
    const orders = [order({ status: "ready", readyAt: NOW - 3 * MINUTE })];
    expect(shedCount(orders, 300, NOW)).toBe(0);
    expect(shedCount(orders, 60, NOW)).toBe(1);
  });
});

describe("shedMinutes", () => {
  it("renders the timeout in whole minutes", () => {
    expect(shedMinutes(300)).toBe(5);
    expect(shedMinutes(600)).toBe(10);
  });

  it("never says zero minutes for a sub-minute timeout", () => {
    // §9 allows 30 s, and "0 ready over 0 min" would be nonsense.
    expect(shedMinutes(30)).toBe(1);
  });
});

describe("the count and the request agree", () => {
  it("uses the same rule the server applies to the clearAll it sends", () => {
    const orders = [staleReady(), freshReady(), order(), staleReady()];
    const filters = shedFilters(TIMEOUT);

    // What the server will clear when the console posts `clearAll` with these filters.
    const serverWouldClear = orders.filter((o) => shouldClearAll(o, filters, NOW));

    expect(shedOrders(orders, TIMEOUT, NOW)).toEqual(serverWouldClear);
    expect(shedCount(orders, TIMEOUT, NOW)).toBe(serverWouldClear.length);
  });
});
