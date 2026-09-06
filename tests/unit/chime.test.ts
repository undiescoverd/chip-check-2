import { describe, expect, it } from "vitest";
import { nextSeenReady, seedSeenReady } from "@/lib/display/chime";
import type { Order } from "@/lib/types";

/**
 * The pure half of §22.1's chime: which ids are newly ready, given what has already been
 * seen. The seeding rule is the one worth getting wrong in the other direction — a shop
 * that opens the display mid-service must not chime for every order already on it.
 */

function order(id: string, status: Order["status"] = "ready"): Order {
  return {
    id,
    orderNumber: id,
    status,
    createdAt: 0,
    readyAt: status === "ready" ? 0 : null,
    cleared: false,
    clearedAt: null,
    clearedBy: null,
  };
}

describe("seedSeenReady", () => {
  it("seeds every already-ready id, so none of them chime", () => {
    const orders = [order("a"), order("b"), order("c", "preparing")];
    const seen = seedSeenReady(orders);

    expect(seen).toEqual(new Set(["a", "b"]));
    expect(nextSeenReady(seen, orders).newlyReadyIds).toEqual([]);
  });

  it("seeds an empty set from an empty or all-preparing board", () => {
    expect(seedSeenReady([])).toEqual(new Set());
    expect(seedSeenReady([order("a", "preparing")])).toEqual(new Set());
  });
});

describe("nextSeenReady", () => {
  it("reports an id that turns ready after seeding", () => {
    const seeded = seedSeenReady([order("a", "preparing")]);
    const next = nextSeenReady(seeded, [order("a", "ready")]);

    expect(next.newlyReadyIds).toEqual(["a"]);
    expect(next.seen).toEqual(new Set(["a"]));
  });

  it("does not re-report an id already accounted for", () => {
    const seen = new Set(["a"]);
    const next = nextSeenReady(seen, [order("a", "ready"), order("b", "ready")]);

    expect(next.newlyReadyIds).toEqual(["b"]);
  });

  it("drops a cleared order from the returned seen set", () => {
    // Once an id is no longer in the order list at all, there is nothing to evict later —
    // it can never come back with the same id, so carrying it forward would only grow
    // the set for the life of the page.
    const seen = new Set(["a", "b"]);
    const next = nextSeenReady(seen, [order("b", "ready")]);

    expect(next.seen).toEqual(new Set(["b"]));
  });

  it("never reports a preparing order as newly ready", () => {
    const next = nextSeenReady(new Set(), [order("a", "preparing")]);
    expect(next.newlyReadyIds).toEqual([]);
  });

  it("chains across calls the way the display actually calls it", () => {
    let seen = seedSeenReady([]); // empty board on connect

    let step = nextSeenReady(seen, [order("a", "preparing")]);
    expect(step.newlyReadyIds).toEqual([]);
    seen = step.seen;

    step = nextSeenReady(seen, [order("a", "ready")]);
    expect(step.newlyReadyIds).toEqual(["a"]);
    seen = step.seen;

    // Still ready on the next snapshot — no repeat chime.
    step = nextSeenReady(seen, [order("a", "ready")]);
    expect(step.newlyReadyIds).toEqual([]);
  });
});
