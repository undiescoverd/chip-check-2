import { describe, expect, it } from "vitest";
import { visibleOrders } from "@/lib/orders/visible";
import type { Order } from "@/lib/types";

/**
 * §22.1's ready-timeout filter — the customer display's mirror of the staff console's
 * shed nudge (`tests/unit/shed.test.ts`): the same rule, read the opposite way. A ready
 * order this hides is exactly one the shed nudge would offer to clear.
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

describe("visibleOrders", () => {
  it("never hides a preparing order, however old", () => {
    const ancient = order({ createdAt: NOW - 5 * 60 * MINUTE });
    expect(visibleOrders([ancient], TIMEOUT, NOW)).toEqual([ancient]);
  });

  it("keeps a ready order until its own timeout, then drops it", () => {
    const justReady = order({ status: "ready", readyAt: NOW - MINUTE });
    const staleReady = order({ status: "ready", readyAt: NOW - 6 * MINUTE });

    expect(visibleOrders([justReady, staleReady], TIMEOUT, NOW)).toEqual([justReady]);
  });

  it("follows the shop's own timeout, not a fixed one", () => {
    const readyThreeMinAgo = order({ status: "ready", readyAt: NOW - 3 * MINUTE });
    expect(visibleOrders([readyThreeMinAgo], 300, NOW)).toEqual([readyThreeMinAgo]);
    expect(visibleOrders([readyThreeMinAgo], 60, NOW)).toEqual([]);
  });

  it("shows a ready order with an unresolved readyAt rather than hiding it", () => {
    // A `serverTimestamp()` read back in the same tick it was written (§9) — treated as
    // "not yet timed out", never as "always timed out".
    const justWritten = order({ status: "ready", readyAt: null });
    expect(visibleOrders([justWritten], TIMEOUT, NOW)).toEqual([justWritten]);
  });

  it("is the exact complement of the shed nudge's own filter", () => {
    const orders = [
      order({ status: "ready", readyAt: NOW - 6 * MINUTE }),
      order({ status: "ready", readyAt: NOW - MINUTE }),
      order(),
    ];
    const visible = visibleOrders(orders, TIMEOUT, NOW);
    const hidden = orders.filter((o) => !visible.includes(o));

    expect(hidden).toHaveLength(1);
    expect(hidden[0].status).toBe("ready");
  });
});
