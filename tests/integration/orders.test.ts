import { beforeEach, describe, expect, it } from "vitest";
import { UNDO_WINDOW_MS } from "@/lib/orders/rules";
import { resetFlagsCache } from "@/lib/server/entitlement";
import { addOrder, clear, clearAll, markReady, recall, unclear } from "@/lib/server/orders";
import { purgeAll, purgeShop } from "@/lib/server/purge";
import {
  backdate,
  clearEmulator,
  expectApiError,
  lockExists,
  lockHolder,
  rawOrder,
  seedShop,
} from "./helpers";

/**
 * The orders write path against the real Firestore emulator.
 *
 * This is where the phase's actual risk is: transaction ordering, the dedupe race, lock
 * re-acquisition on undo, batch chunking. None of it can be proven by a mock — a mock
 * only proves the mock agrees with itself.
 */

const SHOP = "shop1";
const IP = "203.0.113.7";

beforeEach(async () => {
  await clearEmulator();
  resetFlagsCache();
  await seedShop(SHOP);
});

describe("add", () => {
  it("creates the order and takes the lock", async () => {
    const order = await addOrder(SHOP, "0042", IP);

    expect(order.orderNumber).toBe("0042");
    expect(order.status).toBe("preparing");
    expect(order.cleared).toBe(false);
    expect(order.clearedBy).toBeNull();
    // §13: createdAt is resolved by re-reading, so it must never come back null.
    expect(order.createdAt).toBeTypeOf("number");
    expect(await lockHolder(SHOP, "0042")).toBe(order.id);
  });

  it("preserves leading zeros — 0042 is not 42", async () => {
    await addOrder(SHOP, "0042", IP);
    const second = await addOrder(SHOP, "42", IP);

    expect(second.orderNumber).toBe("42");
    expect(await lockExists(SHOP, "0042")).toBe(true);
    expect(await lockExists(SHOP, "42")).toBe(true);
  });

  it("refuses a duplicate and hands back the order already holding the number", async () => {
    const first = await addOrder(SHOP, "0042", IP);
    const err = await expectApiError(addOrder(SHOP, "0042", IP));

    expect(err.status).toBe(409);
    expect(err.code).toBe("duplicate_order");
    expect((err.details?.order as { id: string }).id).toBe(first.id);
  });

  it("lets the number be reused once the first order is cleared", async () => {
    const first = await addOrder(SHOP, "0042", IP);
    await clear(SHOP, first.id);

    const second = await addOrder(SHOP, "0042", IP);
    expect(second.id).not.toBe(first.id);
    expect(await lockHolder(SHOP, "0042")).toBe(second.id);
  });

  it("rejects an order number outside the shop's digit rule", async () => {
    await seedShop(SHOP, { ticketMinDigits: 2, ticketMaxDigits: 5 });

    const err = await expectApiError(addOrder(SHOP, "1", IP));
    expect(err.status).toBe(400);
    expect(err.code).toBe("invalid_order_number");
    expect(err.details).toMatchObject({ min: 2, max: 5 });

    await expectApiError(addOrder(SHOP, "123456", IP));
  });

  it("404s on an unknown shop", async () => {
    const err = await expectApiError(addOrder("no-such-shop", "1", IP));
    expect(err.status).toBe(404);
  });

  /**
   * The race the lock exists to prevent: two tablets adding the same number at once.
   * Exactly one must win — this is the assertion §28b calls out as the silent failure
   * that "looks fine until two tablets collide mid-service".
   */
  it("lets exactly one of two concurrent adds win", async () => {
    const results = await Promise.allSettled([
      addOrder(SHOP, "0042", IP),
      addOrder(SHOP, "0042", "198.51.100.9"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.code).toBe("duplicate_order");

    const snap = await rawOrder(SHOP, (fulfilled[0] as PromiseFulfilledResult<{ id: string }>).value.id);
    expect(snap).not.toBeNull();
    expect(await lockExists(SHOP, "0042")).toBe(true);
  });

  it("lets exactly one of five concurrent adds win", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => addOrder(SHOP, "7", IP)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("markReady and recall", () => {
  it("moves an order to ready and back", async () => {
    const order = await addOrder(SHOP, "1", IP);

    const ready = await markReady(SHOP, order.id);
    expect(ready.status).toBe("ready");
    expect(ready.readyAt).toBeTypeOf("number");

    const back = await recall(SHOP, order.id);
    expect(back.status).toBe("preparing");
    expect(back.readyAt).toBeNull();
  });

  it("refuses to mark an already-ready order ready again", async () => {
    const order = await addOrder(SHOP, "1", IP);
    await markReady(SHOP, order.id);

    const err = await expectApiError(markReady(SHOP, order.id));
    expect(err.status).toBe(409);
    expect(err.code).toBe("invalid_transition");
    expect(err.details).toMatchObject({ status: "ready", cleared: false });
  });

  it("refuses to recall a preparing order — v1 silently succeeded here", async () => {
    const order = await addOrder(SHOP, "1", IP);
    const err = await expectApiError(recall(SHOP, order.id));
    expect(err.code).toBe("invalid_transition");
  });

  it("404s on an unknown order id", async () => {
    const err = await expectApiError(markReady(SHOP, "nope"));
    expect(err.status).toBe(404);
    expect(err.code).toBe("order_not_found");
  });

  it("leaves the lock alone", async () => {
    const order = await addOrder(SHOP, "1", IP);
    await markReady(SHOP, order.id);
    expect(await lockHolder(SHOP, "1")).toBe(order.id);
  });
});

describe("clear", () => {
  it("soft-deletes, releases the lock, and leaves status untouched", async () => {
    const order = await addOrder(SHOP, "1", IP);
    await markReady(SHOP, order.id);

    const cleared = await clear(SHOP, order.id);
    expect(cleared.cleared).toBe(true);
    expect(cleared.clearedBy).toBe("staff");
    // Status is deliberately preserved so an undo restores the order exactly as it was.
    expect(cleared.status).toBe("ready");
    expect(await lockExists(SHOP, "1")).toBe(false);
  });

  it("refuses to clear twice", async () => {
    const order = await addOrder(SHOP, "1", IP);
    await clear(SHOP, order.id);

    const err = await expectApiError(clear(SHOP, order.id));
    expect(err.status).toBe(409);
    expect(err.code).toBe("invalid_transition");
  });

  it("never hard-deletes the document", async () => {
    const order = await addOrder(SHOP, "1", IP);
    await clear(SHOP, order.id);
    expect(await rawOrder(SHOP, order.id)).not.toBeNull();
  });
});

describe("unclear", () => {
  it("restores the order and re-creates the lock", async () => {
    const order = await addOrder(SHOP, "0042", IP);
    await clear(SHOP, order.id);
    expect(await lockExists(SHOP, "0042")).toBe(false);

    const restored = await unclear(SHOP, order.id);

    expect(restored.cleared).toBe(false);
    expect(restored.clearedAt).toBeNull();
    expect(restored.clearedBy).toBeNull();
    expect(await lockHolder(SHOP, "0042")).toBe(order.id);
  });

  it("brings back an order cleared while ready as ready, not preparing", async () => {
    const order = await addOrder(SHOP, "1", IP);
    await markReady(SHOP, order.id);
    await clear(SHOP, order.id);

    const restored = await unclear(SHOP, order.id);
    expect(restored.status).toBe("ready");
  });

  it("refuses when the number has gone active again, leaving the new order untouched", async () => {
    const first = await addOrder(SHOP, "0042", IP);
    await clear(SHOP, first.id);
    const second = await addOrder(SHOP, "0042", IP);

    const err = await expectApiError(unclear(SHOP, first.id));
    expect(err.status).toBe(409);
    expect(err.code).toBe("duplicate_order");
    expect((err.details?.order as { id: string }).id).toBe(second.id);

    // The re-added order must be exactly as it was.
    const stillThere = await rawOrder(SHOP, second.id);
    expect(stillThere?.cleared).toBe(false);
    expect(await lockHolder(SHOP, "0042")).toBe(second.id);
  });

  it("refuses once the 60 s window has closed, and leaves the lock free", async () => {
    const order = await addOrder(SHOP, "0042", IP);
    await clear(SHOP, order.id);

    const err = await expectApiError(
      unclear(SHOP, order.id, Date.now() + UNDO_WINDOW_MS + 1_000),
    );
    expect(err.status).toBe(409);
    expect(err.code).toBe("invalid_transition");

    // Nothing was written, so the number stays available for a genuine re-add.
    expect(await lockExists(SHOP, "0042")).toBe(false);
    const untouched = await rawOrder(SHOP, order.id);
    expect(untouched?.cleared).toBe(true);
  });

  it("still works just inside the window", async () => {
    const order = await addOrder(SHOP, "1", IP);
    await clear(SHOP, order.id);

    const restored = await unclear(SHOP, order.id, Date.now() + UNDO_WINDOW_MS - 5_000);
    expect(restored.cleared).toBe(false);
  });

  it("refuses to unpick a clearAll sweep", async () => {
    const order = await addOrder(SHOP, "1", IP);
    await clearAll(SHOP, {}, IP);

    const err = await expectApiError(unclear(SHOP, order.id));
    expect(err.code).toBe("invalid_transition");
  });

  it("refuses to unpick a purge sweep", async () => {
    const order = await addOrder(SHOP, "1", IP);
    await backdate(SHOP, order.id, "createdAt", 7 * 3600_000);
    await purgeShop(SHOP);

    const err = await expectApiError(unclear(SHOP, order.id));
    expect(err.code).toBe("invalid_transition");
  });

  it("404s on an unknown order", async () => {
    const err = await expectApiError(unclear(SHOP, "nope"));
    expect(err.status).toBe(404);
  });

  it("lets exactly one of two concurrent undos win", async () => {
    const order = await addOrder(SHOP, "0042", IP);
    await clear(SHOP, order.id);

    const results = await Promise.allSettled([
      unclear(SHOP, order.id),
      unclear(SHOP, order.id),
    ]);
    // The second either loses the lock race or finds the order already restored; either
    // way it must not succeed twice or corrupt the lock.
    expect(results.filter((r) => r.status === "fulfilled").length).toBeLessThanOrEqual(1);
    expect(await lockHolder(SHOP, "0042")).toBe(order.id);
  });
});

describe("clearAll", () => {
  it("clears everything when unfiltered and releases every lock", async () => {
    const a = await addOrder(SHOP, "1", IP);
    const b = await addOrder(SHOP, "2", IP);
    await markReady(SHOP, b.id);

    expect(await clearAll(SHOP, {}, IP)).toBe(2);

    expect((await rawOrder(SHOP, a.id))?.clearedBy).toBe("clearAll");
    expect(await lockExists(SHOP, "1")).toBe(false);
    expect(await lockExists(SHOP, "2")).toBe(false);
  });

  it("clears only ready orders when filtered by status", async () => {
    const preparing = await addOrder(SHOP, "1", IP);
    const ready = await addOrder(SHOP, "2", IP);
    await markReady(SHOP, ready.id);

    expect(await clearAll(SHOP, { status: "ready" }, IP)).toBe(1);

    expect((await rawOrder(SHOP, preparing.id))?.cleared).toBe(false);
    expect((await rawOrder(SHOP, ready.id))?.cleared).toBe(true);
    expect(await lockExists(SHOP, "1")).toBe(true);
  });

  /** The shed nudge (§22.2): ready for longer than the shop's timeout, nothing else. */
  it("sheds only ready orders older than the timeout", async () => {
    const preparing = await addOrder(SHOP, "1", IP);
    const oldReady = await addOrder(SHOP, "2", IP);
    const newReady = await addOrder(SHOP, "3", IP);
    await markReady(SHOP, oldReady.id);
    await markReady(SHOP, newReady.id);
    await backdate(SHOP, oldReady.id, "readyAt", 400_000);

    const cleared = await clearAll(SHOP, { status: "ready", olderThanSeconds: 300 }, IP);

    expect(cleared).toBe(1);
    expect((await rawOrder(SHOP, oldReady.id))?.cleared).toBe(true);
    expect((await rawOrder(SHOP, newReady.id))?.cleared).toBe(false);
    expect((await rawOrder(SHOP, preparing.id))?.cleared).toBe(false);
  });

  it("returns zero and changes nothing when nothing matches", async () => {
    await addOrder(SHOP, "1", IP);
    expect(await clearAll(SHOP, { status: "ready" }, IP)).toBe(0);
    expect(await lockExists(SHOP, "1")).toBe(true);
  });

  it("clears more orders than fit in a single batch", async () => {
    // 260 orders is 520 writes — past Firestore's 500-write batch cap, so this fails if
    // the chunk size is wrong.
    const shop = "bulk-shop";
    await seedShop(shop, { ticketMaxDigits: 4 });
    // A distinct IP per add: the §14.1 limit is 60/min per IP, and this test is about
    // batch chunking, not rate limiting (which has its own block below).
    for (let i = 0; i < 260; i += 1) {
      await addOrder(shop, String(1000 + i), `198.51.100.${i}`);
    }

    expect(await clearAll(shop, {}, IP)).toBe(260);
    expect(await lockExists(shop, "1000")).toBe(false);
    expect(await lockExists(shop, "1259")).toBe(false);
  });
});

describe("purge", () => {
  it("clears orders older than six hours and marks them as purged", async () => {
    const stale = await addOrder(SHOP, "1", IP);
    const fresh = await addOrder(SHOP, "2", IP);
    await backdate(SHOP, stale.id, "createdAt", 7 * 3600_000);

    expect(await purgeShop(SHOP)).toBe(1);

    expect((await rawOrder(SHOP, stale.id))?.clearedBy).toBe("purge");
    expect((await rawOrder(SHOP, fresh.id))?.cleared).toBe(false);
    expect(await lockExists(SHOP, "1")).toBe(false);
    expect(await lockExists(SHOP, "2")).toBe(true);
  });

  it("sweeps preparing orders too — nothing else ever clears them", async () => {
    const order = await addOrder(SHOP, "1", IP);
    await backdate(SHOP, order.id, "createdAt", 7 * 3600_000);

    await purgeShop(SHOP);
    expect((await rawOrder(SHOP, order.id))?.status).toBe("preparing");
    expect((await rawOrder(SHOP, order.id))?.cleared).toBe(true);
  });

  it("leaves an order exactly six hours old alone", async () => {
    const order = await addOrder(SHOP, "1", IP);
    await backdate(SHOP, order.id, "createdAt", 6 * 3600_000 - 5_000);
    expect(await purgeShop(SHOP)).toBe(0);
  });

  it("is idempotent", async () => {
    const order = await addOrder(SHOP, "1", IP);
    await backdate(SHOP, order.id, "createdAt", 7 * 3600_000);

    expect(await purgeShop(SHOP)).toBe(1);
    expect(await purgeShop(SHOP)).toBe(0);
  });

  it("sweeps every shop from one collection-group query", async () => {
    await seedShop("shop-a");
    await seedShop("shop-b");
    const a = await addOrder("shop-a", "1", IP);
    const b = await addOrder("shop-b", "2", IP);
    await addOrder("shop-b", "3", IP);
    await backdate("shop-a", a.id, "createdAt", 7 * 3600_000);
    await backdate("shop-b", b.id, "createdAt", 7 * 3600_000);

    const result = await purgeAll();

    expect(result).toEqual({ shopsTouched: 2, ordersCleared: 2 });
    expect(await lockExists("shop-b", "3")).toBe(true);
  });

  it("reports nothing to do on a quiet database", async () => {
    await addOrder(SHOP, "1", IP);
    expect(await purgeAll()).toEqual({ shopsTouched: 0, ordersCleared: 0 });
  });

  it("runs opportunistically on add, so an active shop needs no cron", async () => {
    const stale = await addOrder(SHOP, "1", IP);
    await backdate(SHOP, stale.id, "createdAt", 7 * 3600_000);

    await addOrder(SHOP, "2", IP);

    expect((await rawOrder(SHOP, stale.id))?.clearedBy).toBe("purge");
  });
});

describe("rate limiting", () => {
  it("allows 60 adds a minute from one IP and refuses the 61st", async () => {
    for (let i = 0; i < 60; i += 1) {
      await addOrder(SHOP, String(1000 + i), IP);
    }

    const err = await expectApiError(addOrder(SHOP, "9999", IP));
    expect(err.status).toBe(429);
    expect(err.code).toBe("rate_limited");
    expect(err.details?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("limits per IP, so a second tablet is unaffected", async () => {
    for (let i = 0; i < 60; i += 1) {
      await addOrder(SHOP, String(1000 + i), IP);
    }
    await expectApiError(addOrder(SHOP, "9998", IP));

    const other = await addOrder(SHOP, "9999", "198.51.100.42");
    expect(other.orderNumber).toBe("9999");
  });

  it("opens a fresh window a minute later", async () => {
    for (let i = 0; i < 60; i += 1) {
      await addOrder(SHOP, String(1000 + i), IP);
    }
    await expectApiError(addOrder(SHOP, "9998", IP));

    const later = await addOrder(SHOP, "9999", IP, Date.now() + 61_000);
    expect(later.orderNumber).toBe("9999");
  });

  it("allows five clearAlls a minute and refuses the sixth", async () => {
    for (let i = 0; i < 5; i += 1) {
      await clearAll(SHOP, {}, IP);
    }

    const err = await expectApiError(clearAll(SHOP, {}, IP));
    expect(err.status).toBe(429);
    expect(err.code).toBe("rate_limited");
  });

  it("limits clearAll even when it matches nothing", async () => {
    // The destructive action is limited by call, not by effect.
    for (let i = 0; i < 5; i += 1) await clearAll(SHOP, { status: "ready" }, IP);
    await expectApiError(clearAll(SHOP, { status: "ready" }, IP));
  });

  it("keeps the add and clearAll budgets separate", async () => {
    for (let i = 0; i < 5; i += 1) await clearAll(SHOP, {}, IP);
    await expectApiError(clearAll(SHOP, {}, IP));

    // Adds must still work: exhausting the destructive budget cannot stop service.
    const order = await addOrder(SHOP, "1", IP);
    expect(order.orderNumber).toBe("1");
  });

  it("never rate-limits markReady, recall, clear or unclear", async () => {
    // §14.1: each acts on one existing order, and a Firestore round trip per tap would
    // tax the < 1.5 s sync target to guard nothing.
    const order = await addOrder(SHOP, "1", IP);

    for (let i = 0; i < 30; i += 1) {
      await markReady(SHOP, order.id);
      await recall(SHOP, order.id);
    }

    await clear(SHOP, order.id);
    const restored = await unclear(SHOP, order.id);
    expect(restored.cleared).toBe(false);
  });
});
