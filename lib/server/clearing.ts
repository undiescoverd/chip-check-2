import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/server/admin";
import { activeNumberRef, ordersRef } from "@/lib/server/shops";
import { toOrder } from "@/lib/server/firestore";
import type { Order } from "@/lib/types";

/**
 * Shared clear used by both `clearAll` (§13) and the stale purge (§13.1). It lives here
 * rather than in either caller so `orders.ts` and `purge.ts` don't have to import each
 * other.
 *
 * How many orders run concurrently. Not a Firestore batch-write cap — there is no batch
 * write here (see `clearOne` below) — just a throughput knob: transactions on different
 * order docs never contend with each other, so this only bounds how many run at once.
 */
export const ORDERS_PER_BATCH = 250;

/**
 * Clear one order inside its own transaction, re-reading both the order and its lock
 * fresh rather than trusting the caller's (possibly stale) snapshot.
 *
 * This mirrors `clear()` in `orders.ts` exactly, generalized over `clearedBy`: the
 * earlier version of this function deleted `activeNumbers/{orderNumber}` unconditionally,
 * on the assumption that "the caller already established this order is uncleared, and an
 * uncleared order holding number N *is* the holder of lock N." That assumption breaks
 * under a race a batch (or a stale outer query) cannot see — staff can `clear()` this
 * exact order and add a brand-new order with the *same* number before this call commits,
 * in which case the lock has already moved on to that new order. Deleting it anyway would
 * reopen the number for a third caller while the new order is still active, defeating the
 * one invariant the lock exists to enforce. Re-reading here, in the same transaction as
 * the write, closes that window the way every other mutation in `orders.ts` already does.
 *
 * Returns `false` (without writing anything) if the order no longer exists or was already
 * cleared by the time this ran — both are "someone else already handled it," not errors.
 */
async function clearOne(shopId: string, orderId: string, clearedBy: "clearAll" | "purge"): Promise<boolean> {
  const db = adminDb();
  const orderRef = ordersRef(shopId).doc(orderId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return false;

    const order = toOrder(snap.id, snap.data()!);
    if (order.cleared) return false;

    const lockRef = activeNumberRef(shopId, order.orderNumber);
    const lockSnap = await tx.get(lockRef);

    tx.update(orderRef, {
      cleared: true,
      clearedAt: FieldValue.serverTimestamp(),
      clearedBy,
    });

    // Only release the lock if it is still this order's — see the note above.
    if (lockSnap.exists && lockSnap.data()?.orderId === order.id) {
      tx.delete(lockRef);
    }

    return true;
  });
}

export async function clearOrders(
  shopId: string,
  orders: Order[],
  clearedBy: "clearAll" | "purge",
): Promise<number> {
  if (orders.length === 0) return 0;

  let cleared = 0;

  for (let i = 0; i < orders.length; i += ORDERS_PER_BATCH) {
    const chunk = orders.slice(i, i + ORDERS_PER_BATCH);
    const results = await Promise.all(chunk.map((order) => clearOne(shopId, order.id, clearedBy)));
    cleared += results.filter(Boolean).length;
  }

  return cleared;
}
