import type { Order } from "@/lib/types";

/**
 * The customer display's ready-timeout filter (§22.1) — display-layer only.
 *
 * A ready order keeps showing until `readyTimeoutSeconds` after `readyAt`, then drops
 * off the board. `preparing` orders never auto-clear here or anywhere (CLAUDE.md
 * invariant) — only a `ready` order with a resolved `readyAt` is ever subject to it, and
 * a `readyAt` that has not resolved yet (a `serverTimestamp()` read back in the same
 * tick, §9) is treated as "not yet timed out" rather than "always timed out".
 *
 * The staff console never applies this filter (§22.2) — ready orders stay on its list
 * until cleared. This is why the shed nudge (`lib/orders/shed.ts`) exists: it surfaces
 * exactly the orders this function has already hidden from the customer board.
 */
export function visibleOrders(
  orders: Order[],
  readyTimeoutSeconds: number,
  nowMs: number,
): Order[] {
  return orders.filter(
    (order) =>
      order.status !== "ready" ||
      order.readyAt === null ||
      order.readyAt > nowMs - readyTimeoutSeconds * 1000,
  );
}
