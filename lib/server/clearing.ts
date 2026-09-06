import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/server/admin";
import { activeNumberRef, ordersRef } from "@/lib/server/shops";
import type { Order } from "@/lib/types";

/**
 * Shared batch-clear used by both `clearAll` (§13) and the stale purge (§13.1). It lives
 * here rather than in either caller so `orders.ts` and `purge.ts` don't have to import
 * each other.
 *
 * Firestore caps a batch at 500 writes. Clearing one order costs two — the order update
 * and its lock delete — so the chunk is 250 orders, not the 500 a quick reading of §13
 * suggests.
 */
export const ORDERS_PER_BATCH = 250;

/**
 * Locks are deleted without re-reading them: the caller has already established that
 * these orders are uncleared, and an uncleared order holding number N *is* the holder of
 * lock N. Reading each lock first would double the read cost for no extra guarantee.
 */
export async function clearOrders(
  shopId: string,
  orders: Order[],
  clearedBy: "clearAll" | "purge",
): Promise<number> {
  if (orders.length === 0) return 0;

  const db = adminDb();
  const collection = ordersRef(shopId);
  let cleared = 0;

  for (let i = 0; i < orders.length; i += ORDERS_PER_BATCH) {
    const chunk = orders.slice(i, i + ORDERS_PER_BATCH);
    const batch = db.batch();

    for (const order of chunk) {
      batch.update(collection.doc(order.id), {
        cleared: true,
        clearedAt: FieldValue.serverTimestamp(),
        clearedBy,
      });
      batch.delete(activeNumberRef(shopId, order.orderNumber));
    }

    await batch.commit();
    cleared += chunk.length;
  }

  return cleared;
}
