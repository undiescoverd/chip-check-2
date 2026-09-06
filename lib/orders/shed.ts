import { shouldClearAll, type ClearAllFilters } from "@/lib/orders/rules";
import type { Order } from "@/lib/types";

/**
 * The shed nudge (§22.2): `{n} ready over {m} min — clear?`.
 *
 * These are exactly the orders that have already dropped off the customer display (the
 * display filters ready orders past `readyTimeoutSeconds`, §22.1) and that nobody is
 * coming to collect. The staff console never applies that filter itself — ready orders
 * stay on the list until cleared (v1 invariant) — so this *surfaces* them; it never
 * hides them.
 *
 * The count and the request body come from `shedFilters` so they cannot drift: the
 * nudge says "3" only if `clearAll` with those filters would clear 3. It is the same
 * `shouldClearAll` the server runs, which is why the number on the button is the number
 * that disappears.
 */

export function shedFilters(readyTimeoutSeconds: number): ClearAllFilters {
  return { status: "ready", olderThanSeconds: readyTimeoutSeconds };
}

export function shedOrders(
  orders: Order[],
  readyTimeoutSeconds: number,
  nowMs: number,
): Order[] {
  const filters = shedFilters(readyTimeoutSeconds);
  return orders.filter((order) => shouldClearAll(order, filters, nowMs));
}

export function shedCount(
  orders: Order[],
  readyTimeoutSeconds: number,
  nowMs: number,
): number {
  return shedOrders(orders, readyTimeoutSeconds, nowMs).length;
}

/**
 * The `{m}` in the nudge copy. `readyTimeoutSeconds` is 30–3600 (§9), so a shop set to
 * 90 s would otherwise read "1.5 min"; whole minutes with a floor of 1 keeps the copy
 * honest about the order of magnitude without inventing a decimal.
 */
export function shedMinutes(readyTimeoutSeconds: number): number {
  return Math.max(1, Math.round(readyTimeoutSeconds / 60));
}
