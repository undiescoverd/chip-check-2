import { describe, expect, it } from "vitest";
import {
  PENDING_TIMEOUT_MS,
  addKey,
  applyServerOrder,
  clearPending,
  emptyPending,
  isConfirmed,
  markPending,
  mergeOrders,
  overlayOrders,
  pendingKeys,
  reconcilePending,
} from "@/lib/orders/pending";
import type { Order } from "@/lib/types";

/**
 * The optimistic overlay (§12).
 *
 * Two invariants are load-bearing and get their own tests: the overlay never invents a
 * row, and the snapshot always wins in the end. v1 shipped an overlay it never called;
 * the failure mode of one that *is* called is a row that lingers after the truth changed.
 */

const NOW = 1_700_000_000_000;

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: "order1",
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

describe("addKey", () => {
  it("keys an add by its number, since the row has no id yet", () => {
    expect(addKey("0042")).toBe("add:0042");
  });

  it("keeps leading zeros distinct — 0042 is not 42", () => {
    expect(addKey("0042")).not.toBe(addKey("42"));
  });
});

describe("markPending / clearPending", () => {
  it("marks a key in flight and reports it", () => {
    const state = markPending(emptyPending(), "order1", NOW);
    expect(pendingKeys(state).has("order1")).toBe(true);
  });

  it("holds no overlay row until the server returns one", () => {
    // §12: the overlay never invents rows. Between tap and response there is nothing to
    // show — only a disabled button.
    const state = markPending(emptyPending(), addKey("0042"), NOW);
    expect(overlayOrders(state)).toEqual([]);
  });

  it("drops the entry and its row on clear", () => {
    let state = markPending(emptyPending(), "order1", NOW);
    state = applyServerOrder(state, "order1", order());
    state = clearPending(state, "order1");

    expect(pendingKeys(state).size).toBe(0);
    expect(overlayOrders(state)).toEqual([]);
  });

  it("ignores a clear for a key that is not pending", () => {
    const state = emptyPending();
    expect(clearPending(state, "nope")).toBe(state);
  });
});

describe("applyServerOrder", () => {
  it("attaches the returned row so it can render before the snapshot", () => {
    let state = markPending(emptyPending(), "order1", NOW);
    state = applyServerOrder(state, "order1", order({ status: "ready" }));

    expect(overlayOrders(state)).toHaveLength(1);
    expect(overlayOrders(state)[0].status).toBe("ready");
  });

  /**
   * The failed-undo case from §12, stated as a rule: a response that arrives after the
   * caller gave up must not resurrect anything. Without this guard a 409'd `unclear`
   * whose entry was already cleared could put the row back on the board.
   */
  it("refuses to resurrect an entry that is no longer pending", () => {
    let state = markPending(emptyPending(), "order1", NOW);
    state = clearPending(state, "order1");
    state = applyServerOrder(state, "order1", order());

    expect(pendingKeys(state).size).toBe(0);
    expect(overlayOrders(state)).toEqual([]);
  });
});

describe("isConfirmed", () => {
  it("confirms a clear when the row has left the active list", () => {
    // The snapshot is filtered to cleared == false, so a cleared order does not appear
    // as a cleared row — it simply vanishes.
    expect(isConfirmed(order({ cleared: true }), undefined)).toBe(true);
  });

  it("does not confirm a clear while the row is still in the list", () => {
    expect(isConfirmed(order({ cleared: true }), order())).toBe(false);
  });

  it("confirms markReady only once the snapshot agrees on the status", () => {
    const ready = order({ status: "ready" });
    expect(isConfirmed(ready, order({ status: "preparing" }))).toBe(false);
    expect(isConfirmed(ready, ready)).toBe(true);
  });

  it("confirms recall the same way, in reverse", () => {
    const back = order({ status: "preparing" });
    expect(isConfirmed(back, order({ status: "ready" }))).toBe(false);
    expect(isConfirmed(back, back)).toBe(true);
  });

  it("confirms an add or an unclear once the row is present", () => {
    expect(isConfirmed(order(), undefined)).toBe(false);
    expect(isConfirmed(order(), order())).toBe(true);
  });
});

describe("reconcilePending", () => {
  it("retires an entry the snapshot has confirmed", () => {
    let state = markPending(emptyPending(), "order1", NOW);
    state = applyServerOrder(state, "order1", order({ status: "ready" }));

    const after = reconcilePending(state, [order({ status: "ready" })], NOW);
    expect(pendingKeys(after).size).toBe(0);
  });

  it("keeps an entry the snapshot has not caught up with", () => {
    let state = markPending(emptyPending(), "order1", NOW);
    state = applyServerOrder(state, "order1", order({ status: "ready" }));

    const after = reconcilePending(state, [order({ status: "preparing" })], NOW);
    expect(pendingKeys(after).has("order1")).toBe(true);
  });

  it("keeps an in-flight entry with nothing to confirm against", () => {
    const state = markPending(emptyPending(), addKey("0042"), NOW);
    const after = reconcilePending(state, [], NOW);
    expect(pendingKeys(after).has(addKey("0042"))).toBe(true);
  });

  it("gives up at the 5 s cap, so a dropped snapshot cannot disable a button forever", () => {
    let state = markPending(emptyPending(), "order1", NOW);
    state = applyServerOrder(state, "order1", order({ status: "ready" }));

    const justBefore = reconcilePending(state, [], NOW + PENDING_TIMEOUT_MS - 1);
    expect(pendingKeys(justBefore).size).toBe(1);

    const atCap = reconcilePending(state, [], NOW + PENDING_TIMEOUT_MS);
    expect(pendingKeys(atCap).size).toBe(0);
  });

  it("retires an add once its row appears in the snapshot", () => {
    let state = markPending(emptyPending(), addKey("0042"), NOW);
    state = applyServerOrder(state, addKey("0042"), order());

    const after = reconcilePending(state, [order()], NOW);
    expect(pendingKeys(after).size).toBe(0);
  });

  it("reconciles several entries independently", () => {
    let state = emptyPending();
    state = markPending(state, "order1", NOW);
    state = applyServerOrder(state, "order1", order({ id: "order1", status: "ready" }));
    state = markPending(state, "order2", NOW);
    state = applyServerOrder(state, "order2", order({ id: "order2", status: "ready" }));

    // Only order1 has caught up.
    const after = reconcilePending(
      state,
      [order({ id: "order1", status: "ready" }), order({ id: "order2", status: "preparing" })],
      NOW,
    );

    expect(pendingKeys(after).has("order1")).toBe(false);
    expect(pendingKeys(after).has("order2")).toBe(true);
  });
});

describe("mergeOrders", () => {
  it("shows an added row before the snapshot has it", () => {
    // The point of the overlay: the row appears on the tap, not on the round trip.
    const merged = mergeOrders([], [order()], NOW);
    expect(merged.map((o) => o.id)).toEqual(["order1"]);
  });

  it("lets the overlay override a stale snapshot row", () => {
    const merged = mergeOrders([order({ status: "preparing" })], [order({ status: "ready" })], NOW);
    expect(merged[0].status).toBe("ready");
  });

  it("removes a cleared row immediately rather than waiting for the snapshot", () => {
    const merged = mergeOrders([order()], [order({ cleared: true })], NOW);
    expect(merged).toEqual([]);
  });

  it("leaves the snapshot alone when nothing is pending", () => {
    const snapshot = [order({ id: "a", createdAt: 1 }), order({ id: "b", createdAt: 2 })];
    expect(mergeOrders(snapshot, [], NOW).map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("sorts by createdAt ascending (§11)", () => {
    const snapshot = [
      order({ id: "late", createdAt: 300 }),
      order({ id: "early", createdAt: 100 }),
      order({ id: "mid", createdAt: 200 }),
    ];
    expect(mergeOrders(snapshot, [], NOW).map((o) => o.id)).toEqual(["early", "mid", "late"]);
  });

  it("sorts an unresolved createdAt to the end without an unstable comparator", () => {
    // A serverTimestamp() not yet resolved reads as null. Falling back to a fresh
    // Date.now() *inside* the comparator would give a different key on every comparison,
    // which is an inconsistent ordering — the kind that scrambles a list or throws.
    const snapshot = [
      order({ id: "pending", createdAt: null }),
      order({ id: "settled", createdAt: NOW - 1000 }),
    ];
    expect(mergeOrders(snapshot, [], NOW).map((o) => o.id)).toEqual(["settled", "pending"]);
  });

  it("produces the same order however many times it runs", () => {
    const snapshot = [
      order({ id: "a", createdAt: null }),
      order({ id: "b", createdAt: null }),
      order({ id: "c", createdAt: 5 }),
    ];
    const once = mergeOrders(snapshot, [], NOW).map((o) => o.id);
    const twice = mergeOrders(snapshot, [], NOW).map((o) => o.id);
    expect(once).toEqual(twice);
  });
});

/**
 * The lifecycles end to end, since the individual rules compose in ways worth pinning
 * down — particularly the undo path, which §12 calls out as "where the overlay inventing
 * a row would be most tempting and most wrong".
 */
describe("full mutation lifecycles", () => {
  it("add: disabled, then the row appears, then the snapshot takes over", () => {
    const key = addKey("0042");
    let state = markPending(emptyPending(), key, NOW);

    // Tap: button disabled, nothing on the board yet.
    expect(pendingKeys(state).has(key)).toBe(true);
    expect(mergeOrders([], overlayOrders(state), NOW)).toEqual([]);

    // Server responds: the row shows immediately.
    state = applyServerOrder(state, key, order());
    expect(mergeOrders([], overlayOrders(state), NOW).map((o) => o.id)).toEqual(["order1"]);

    // Snapshot catches up: the entry retires and the snapshot alone drives the list.
    state = reconcilePending(state, [order()], NOW);
    expect(pendingKeys(state).size).toBe(0);
    expect(mergeOrders([order()], overlayOrders(state), NOW).map((o) => o.id)).toEqual(["order1"]);
  });

  it("clear then undo: the row leaves, comes back, and is never invented", () => {
    // Clear.
    let state = markPending(emptyPending(), "order1", NOW);
    state = applyServerOrder(state, "order1", order({ cleared: true, clearedBy: "staff" }));
    expect(mergeOrders([order()], overlayOrders(state), NOW)).toEqual([]);

    // Snapshot agrees the row is gone.
    state = reconcilePending(state, [], NOW);
    expect(pendingKeys(state).size).toBe(0);

    // Undo, keyed by the order's own id (§12).
    state = markPending(state, "order1", NOW);
    state = applyServerOrder(state, "order1", order());
    expect(mergeOrders([], overlayOrders(state), NOW).map((o) => o.id)).toEqual(["order1"]);
  });

  it("a refused undo restores nothing", () => {
    // 409 because the number went active again (§13). The caller clears the entry and
    // never calls upsertLocal — so the board must show exactly what the snapshot shows.
    let state = markPending(emptyPending(), "order1", NOW);
    state = clearPending(state, "order1");

    expect(overlayOrders(state)).toEqual([]);
    expect(mergeOrders([], overlayOrders(state), NOW)).toEqual([]);
  });

  it("markReady then recall settles on the snapshot both times", () => {
    let state = markPending(emptyPending(), "order1", NOW);
    state = applyServerOrder(state, "order1", order({ status: "ready", readyAt: NOW }));
    expect(mergeOrders([order()], overlayOrders(state), NOW)[0].status).toBe("ready");

    state = reconcilePending(state, [order({ status: "ready", readyAt: NOW })], NOW);
    expect(pendingKeys(state).size).toBe(0);

    state = markPending(state, "order1", NOW);
    state = applyServerOrder(state, "order1", order({ status: "preparing" }));
    expect(
      mergeOrders([order({ status: "ready" })], overlayOrders(state), NOW)[0].status,
    ).toBe("preparing");
  });
});
