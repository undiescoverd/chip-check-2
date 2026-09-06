import type { Order } from "@/lib/types";

/**
 * Order age on the staff card (§22.2).
 *
 * The problem it solves: without it, an order added at 12:01 is visually identical to one
 * added at 12:20, so a forgotten ticket stays invisible until a customer asks about it.
 *
 * The escalation past `targetPrepSeconds` is weight and opacity *inside* the row's own
 * state colour — never a new hue (§20, The No-Third-Colour Rule). This module only says
 * *whether* a row is over target; `OrderCard` owns what that looks like.
 *
 * Pure. The console passes `nowMs` from the tick it already re-renders on, so there are
 * no per-card timers.
 */

/**
 * How long the order has been waiting, from `createdAt` — including after it goes ready,
 * because the customer's wait does not stop when the fryer's does.
 *
 * A null `createdAt` is an unresolved `serverTimestamp()` on a row that arrived
 * milliseconds ago (§9), so its true age is ~0. Negative values (clock skew between the
 * device and Firestore) clamp to zero rather than rendering "-1m".
 */
export function ageMs(order: Order, nowMs: number): number {
  if (order.createdAt === null) return 0;
  return Math.max(0, nowMs - order.createdAt);
}

/**
 * `{m}m` under an hour, `{h}h {m}m` above it (§23). No unit words, no seconds: seconds
 * would change every tick and pull the eye away from the order number, which is the one
 * thing on the row that must stay dominant (§20, The Numerals-First Rule).
 */
export function formatAge(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Past the shop's prep target (§9's `targetPrepSeconds`, 60–3600, default 480). */
export function isOverTarget(order: Order, targetPrepSeconds: number, nowMs: number): boolean {
  return ageMs(order, nowMs) >= targetPrepSeconds * 1000;
}
