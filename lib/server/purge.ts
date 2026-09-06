import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { STALE_HOURS, purgeCutoff } from "@/lib/orders/rules";
import { adminDb } from "@/lib/server/admin";
import { clearOrders } from "@/lib/server/clearing";
import { toOrder } from "@/lib/server/firestore";
import { ordersRef } from "@/lib/server/shops";
import type { Order } from "@/lib/types";

/**
 * Stale purge (§13.1).
 *
 * Orders left uncleared for more than six hours are swept. This is the only thing that
 * ever clears a `preparing` order — the display's ready-timeout is a display filter and
 * never writes (v1 invariant).
 *
 * Purged orders are marked `clearedBy: "purge"`, which is what makes them permanently
 * un-undoable: `unclear` accepts only `clearedBy === "staff"` (§13).
 */
export { STALE_HOURS };

/** Idempotent: a second run finds nothing left to clear. */
export async function purgeShop(shopId: string, nowMs: number = Date.now()): Promise<number> {
  const cutoff = Timestamp.fromMillis(purgeCutoff(nowMs));

  const snap = await ordersRef(shopId)
    .where("cleared", "==", false)
    .where("createdAt", "<", cutoff)
    .get();

  if (snap.empty) return 0;

  const stale: Order[] = snap.docs.map((doc) => toOrder(doc.id, doc.data()));
  return clearOrders(shopId, stale, "purge");
}

export interface PurgeAllResult {
  shopsTouched: number;
  ordersCleared: number;
}

/**
 * The cron sweep. One collection-group query across every shop, grouped by parent shop,
 * then the same per-shop batch clear — so an idle shop nobody is adding to still gets
 * tidied even though the opportunistic purge on `add` never fires for it.
 */
export async function purgeAll(nowMs: number = Date.now()): Promise<PurgeAllResult> {
  const cutoff = Timestamp.fromMillis(purgeCutoff(nowMs));

  const snap = await adminDb()
    .collectionGroup("orders")
    .where("cleared", "==", false)
    .where("createdAt", "<", cutoff)
    .get();

  const byShop = new Map<string, Order[]>();
  for (const doc of snap.docs) {
    const shopId = doc.ref.parent.parent?.id;
    if (!shopId) continue;
    const list = byShop.get(shopId) ?? [];
    list.push(toOrder(doc.id, doc.data()));
    byShop.set(shopId, list);
  }

  let ordersCleared = 0;
  let shopsTouched = 0;
  for (const [shopId, orders] of Array.from(byShop.entries())) {
    const cleared = await clearOrders(shopId, orders, "purge");
    if (cleared > 0) {
      shopsTouched += 1;
      ordersCleared += cleared;
    }
  }

  return { shopsTouched, ordersCleared };
}
