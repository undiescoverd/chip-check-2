import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import {
  RATE_LIMITS,
  canClear,
  canMarkReady,
  canRecall,
  canUnclear,
  isValidOrderNumber,
  shouldClearAll,
  type ClearAllFilters,
  type Guard,
} from "@/lib/orders/rules";
import { adminDb } from "@/lib/server/admin";
import { clearOrders } from "@/lib/server/clearing";
import { requireEntitled } from "@/lib/server/entitlement";
import { ApiError } from "@/lib/server/errors";
import { toOrder } from "@/lib/server/firestore";
import { hashIp } from "@/lib/server/http";
import { purgeShop } from "@/lib/server/purge";
import {
  applyRateLimit,
  consumeRateLimit,
  rateLimitsRef,
  readBuckets,
} from "@/lib/server/rateLimit";
import { activeNumberRef, getShop, ordersRef } from "@/lib/server/shops";
import type { Order } from "@/lib/types";

/**
 * The orders write path (§13).
 *
 * Every mutation is a transaction, and every transaction does all its reads before any
 * write — Firestore requires it, and it fails only under contention, which is exactly
 * the silent failure mode this phase exists to avoid (§28b).
 *
 * The uniqueness invariant: at most one uncleared order per shop may hold a given order
 * number, enforced by `activeNumbers/{orderNumber}` whose document id *is* the number.
 * Two tablets adding "0042" at once cannot both win.
 */

async function readOrder(shopId: string, orderId: string): Promise<Order> {
  const snap = await ordersRef(shopId).doc(orderId).get();
  if (!snap.exists) throw new ApiError(404, "order_not_found");
  return toOrder(snap.id, snap.data()!);
}

function invalidTransition(order: Order): ApiError {
  return new ApiError(409, "invalid_transition", {
    status: order.status,
    cleared: order.cleared,
  });
}

/**
 * `add` (§13).
 *
 * One transaction covering three concerns: the rate limit (§14.1, folded in so it costs
 * no extra round trip), the duplicate check, and the write. Because a rejected request
 * aborts the transaction, neither a duplicate nor an over-limit call increments the
 * counter — the window counts accepted adds, which is what the 60/min ceiling means.
 */
export async function addOrder(
  shopId: string,
  orderNumber: string,
  ip: string,
  nowMs: number = Date.now(),
): Promise<Order> {
  const shop = await getShop(shopId);

  if (!isValidOrderNumber(orderNumber, shop.settings)) {
    throw new ApiError(400, "invalid_order_number", {
      min: shop.settings.ticketMinDigits,
      max: shop.settings.ticketMaxDigits,
    });
  }

  await requireEntitled(shop, nowMs);

  const db = adminDb();
  const orders = ordersRef(shopId);
  const orderRef = orders.doc();
  const lockRef = activeNumberRef(shopId, orderNumber);
  const limitsRef = rateLimitsRef(shopId);
  const ipHash = hashIp(ip);

  await db.runTransaction(async (tx) => {
    // ---- reads ----
    const [limitsSnap, lockSnap] = await Promise.all([tx.get(limitsRef), tx.get(lockRef)]);

    let existing: Order | null = null;
    if (lockSnap.exists) {
      const heldBy = lockSnap.data()?.orderId;
      if (typeof heldBy === "string") {
        const heldSnap = await tx.get(orders.doc(heldBy));
        if (heldSnap.exists) existing = toOrder(heldSnap.id, heldSnap.data()!);
      }
    }

    // ---- decisions ----
    const update = applyRateLimit(
      readBuckets(limitsSnap.exists ? limitsSnap.data() : {}),
      "add",
      ipHash,
      nowMs,
      RATE_LIMITS.add.limit,
      RATE_LIMITS.add.windowMs,
    );
    if (!update.allowed) {
      throw new ApiError(429, "rate_limited", { retryAfterSeconds: update.retryAfterSeconds });
    }

    if (lockSnap.exists) {
      throw new ApiError(409, "duplicate_order", { order: existing });
    }

    // ---- writes ----
    tx.set(orderRef, {
      orderNumber,
      status: "preparing",
      createdAt: FieldValue.serverTimestamp(),
      readyAt: null,
      cleared: false,
      clearedAt: null,
      clearedBy: null,
    });
    tx.set(lockRef, { orderId: orderRef.id, createdAt: FieldValue.serverTimestamp() });
    tx.set(limitsRef, update.buckets);
  });

  // `serverTimestamp()` is a sentinel, not a value — the only way to return a resolved
  // `createdAt` is to read the document back after the commit (§13).
  const created = await readOrder(shopId, orderRef.id);

  // Opportunistic purge (§13.1). Awaited rather than fired and forgotten: a floating
  // promise is not guaranteed to run to completion once the response is sent. The common
  // case is one indexed query returning nothing. A failure here must never fail the add.
  try {
    await purgeShop(shopId, Date.now());
  } catch (err) {
    console.error(`opportunistic purge failed for shop ${shopId}`, err);
  }

  return created;
}

/** Shared shape for the three single-order transitions that only touch the order doc. */
async function transition(
  shopId: string,
  orderId: string,
  guard: (order: Order) => Guard,
  patch: Record<string, unknown>,
): Promise<Order> {
  const db = adminDb();
  const orderRef = ordersRef(shopId).doc(orderId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new ApiError(404, "order_not_found");

    const order = toOrder(snap.id, snap.data()!);
    if (!guard(order).ok) throw invalidTransition(order);

    tx.update(orderRef, patch);
  });

  return readOrder(shopId, orderId);
}

export function markReady(shopId: string, orderId: string): Promise<Order> {
  return transition(shopId, orderId, canMarkReady, {
    status: "ready",
    readyAt: FieldValue.serverTimestamp(),
  });
}

export function recall(shopId: string, orderId: string): Promise<Order> {
  return transition(shopId, orderId, canRecall, {
    status: "preparing",
    readyAt: null,
  });
}

/**
 * `clear` (§13) — soft delete. `status` is deliberately left alone so an undo restores
 * the order exactly as it was: an order cleared while `ready` comes back `ready`.
 */
export async function clear(shopId: string, orderId: string): Promise<Order> {
  const db = adminDb();
  const orderRef = ordersRef(shopId).doc(orderId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new ApiError(404, "order_not_found");

    const order = toOrder(snap.id, snap.data()!);
    if (!canClear(order).ok) throw invalidTransition(order);

    const lockRef = activeNumberRef(shopId, order.orderNumber);
    const lockSnap = await tx.get(lockRef);

    tx.update(orderRef, {
      cleared: true,
      clearedAt: FieldValue.serverTimestamp(),
      clearedBy: "staff",
    });

    // Only release the lock if it is still ours. It should always be — one uncleared
    // order per number is the invariant — but freeing a number another order holds would
    // let a genuine duplicate through, so the check is worth one read.
    if (lockSnap.exists && lockSnap.data()?.orderId === order.id) {
      tx.delete(lockRef);
    }
  });

  return readOrder(shopId, orderId);
}

/**
 * `unclear` (§13) — undo a staff clear.
 *
 * Not a flag flip: `clear` deleted the lock, so the undo has to re-acquire it. If the
 * number went active again in the meantime the undo genuinely cannot succeed.
 *
 * Guards run in §13's order — window before lock — and every one of them throws before
 * any write. That is what makes the expired-window case leave the lock doc free: there is
 * no partial state to clean up, because nothing was written.
 */
export async function unclear(
  shopId: string,
  orderId: string,
  nowMs: number = Date.now(),
): Promise<Order> {
  const db = adminDb();
  const orders = ordersRef(shopId);
  const orderRef = orders.doc(orderId);

  await db.runTransaction(async (tx) => {
    // ---- reads ----
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new ApiError(404, "order_not_found");

    const order = toOrder(snap.id, snap.data()!);
    const lockRef = activeNumberRef(shopId, order.orderNumber);
    const lockSnap = await tx.get(lockRef);

    let active: Order | null = null;
    if (lockSnap.exists) {
      const heldBy = lockSnap.data()?.orderId;
      if (typeof heldBy === "string") {
        const heldSnap = await tx.get(orders.doc(heldBy));
        if (heldSnap.exists) active = toOrder(heldSnap.id, heldSnap.data()!);
      }
    }

    // ---- guards ----
    if (!canUnclear(order, nowMs).ok) throw invalidTransition(order);
    if (lockSnap.exists) throw new ApiError(409, "duplicate_order", { order: active });

    // ---- writes ----
    tx.update(orderRef, { cleared: false, clearedAt: null, clearedBy: null });
    tx.set(lockRef, { orderId: order.id, createdAt: FieldValue.serverTimestamp() });
  });

  return readOrder(shopId, orderId);
}

/**
 * `clearAll` (§13), with the optional `status` / `olderThanSeconds` filters.
 *
 * The filter is applied in memory. A server-side version would need a composite index on
 * `(cleared, status, readyAt)` that §9's index table does not declare, and this query
 * already reads every uncleared order for the shop — so filtering here costs nothing and
 * the index file keeps describing exactly the queries actually issued. Recorded in
 * PROGRESS.md.
 */
export async function clearAll(
  shopId: string,
  filters: ClearAllFilters,
  ip: string,
  nowMs: number = Date.now(),
): Promise<number> {
  // Its own transaction rather than folded in: this is the destructive action, it runs
  // rarely, and it must be limited even when it ends up matching no orders at all.
  await consumeRateLimit(
    shopId,
    "clearAll",
    ip,
    RATE_LIMITS.clearAll.limit,
    RATE_LIMITS.clearAll.windowMs,
    nowMs,
  );

  const snap = await ordersRef(shopId)
    .where("cleared", "==", false)
    .orderBy("createdAt", "asc")
    .get();

  const matching = snap.docs
    .map((doc) => toOrder(doc.id, doc.data()))
    .filter((order) => shouldClearAll(order, filters, nowMs));

  return clearOrders(shopId, matching, "clearAll");
}
