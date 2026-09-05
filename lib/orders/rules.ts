import type { Order, OrderStatus, Settings } from "@/lib/types";

/**
 * Pure decision logic for the orders write path (§13, §13.1, §14.1).
 *
 * Nothing here imports Firestore. Every function is a total function over plain data,
 * so the transition guards, the undo window, the clearAll filter, the purge cutoff and
 * the rate-limit window are all unit-testable without a mock. `lib/server/orders.ts` is
 * the thin transaction layer that reads documents, calls these, and writes.
 *
 * The point of the split: a test that drives a Firestore mock proves the mock behaves,
 * not that the rule is right. Phase 1's failures are silent ones (§28b), so the rules
 * are tested directly.
 */

/**
 * How long after a staff `clear` an undo is still accepted (§13).
 * Deliberately longer than the console's 10 s affordance (§22.2) so the UI never offers
 * an undo the server will refuse.
 */
export const UNDO_WINDOW_MS = 60_000;

/** Orders older than this are swept by the purge (§13.1). Locked v1 decision. */
export const STALE_HOURS = 6;
export const STALE_MS = STALE_HOURS * 60 * 60 * 1000;

/** Rate-limit entries older than this are pruned on every write (§14.1). */
export const RATE_LIMIT_PRUNE_MS = 15 * 60 * 1000;

export const RATE_LIMITS = {
  add: { limit: 60, windowMs: 60_000 },
  clearAll: { limit: 5, windowMs: 60_000 },
} as const;

/**
 * A precondition result. Failures carry the §13 error code so the caller maps straight
 * to a response without re-deriving why it failed.
 */
export type Guard = { ok: true } | { ok: false; code: "invalid_transition" };

const OK: Guard = { ok: true };
const INVALID: Guard = { ok: false, code: "invalid_transition" };

export function canMarkReady(order: Order): Guard {
  if (order.cleared) return INVALID;
  return order.status === "preparing" ? OK : INVALID;
}

export function canRecall(order: Order): Guard {
  if (order.cleared) return INVALID;
  return order.status === "ready" ? OK : INVALID;
}

export function canClear(order: Order): Guard {
  return order.cleared ? INVALID : OK;
}

/**
 * The undo guard (§13). Three conditions, all required:
 *   - the order is actually cleared;
 *   - it was cleared by staff — a `purge` or `clearAll` sweep is never unpicked one row
 *     at a time;
 *   - the clear happened within the last 60 s.
 *
 * The fourth condition — that `activeNumbers/{orderNumber}` is free — needs a Firestore
 * read, so it lives in the transaction and produces `duplicate_order` rather than
 * `invalid_transition`. Keeping it out of here is what lets this stay pure.
 */
export function canUnclear(order: Order, nowMs: number): Guard {
  if (!order.cleared) return INVALID;
  if (order.clearedBy !== "staff") return INVALID;
  if (order.clearedAt === null) return INVALID;
  return nowMs - order.clearedAt <= UNDO_WINDOW_MS ? OK : INVALID;
}

/** Per-shop order-number rule: `^\d{min,max}$` (§9, §14). */
export function orderNumberPattern(settings: Settings): RegExp {
  return new RegExp(`^\\d{${settings.ticketMinDigits},${settings.ticketMaxDigits}}$`);
}

export function isValidOrderNumber(orderNumber: string, settings: Settings): boolean {
  return orderNumberPattern(settings).test(orderNumber);
}

export interface ClearAllFilters {
  status?: OrderStatus;
  olderThanSeconds?: number;
}

/**
 * The `clearAll` filter predicate (§13).
 *
 * Applied in memory rather than as a Firestore query. Filtering server-side on
 * `cleared == false AND status == ? AND readyAt < ?` would need a third composite index
 * that §9's index table does not declare, and `clearAll` already reads every uncleared
 * order for the shop — so the filter is free here and the index file keeps declaring
 * exactly the queries actually issued. Recorded in PROGRESS.md.
 *
 * Age is measured against `readyAt` for ready orders and `createdAt` otherwise, so the
 * shed nudge (§22.2) sheds orders that have been *waiting* too long, not ones that were
 * merely taken long ago.
 */
export function shouldClearAll(
  order: Order,
  filters: ClearAllFilters,
  nowMs: number,
): boolean {
  if (order.cleared) return false;
  if (filters.status !== undefined && order.status !== filters.status) return false;

  if (filters.olderThanSeconds === undefined) return true;

  const reference = order.status === "ready" ? (order.readyAt ?? order.createdAt) : order.createdAt;
  // An unresolved server timestamp cannot be proven old enough — leave it alone.
  if (reference === null) return false;

  return nowMs - reference >= filters.olderThanSeconds * 1000;
}

/** Orders created before this instant are stale (§13.1). */
export function purgeCutoff(nowMs: number): number {
  return nowMs - STALE_MS;
}

export function isStale(order: Order, nowMs: number): boolean {
  if (order.cleared) return false;
  if (order.createdAt === null) return false;
  return order.createdAt < purgeCutoff(nowMs);
}

export interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  entry: RateLimitEntry;
}

/**
 * Fixed-window rate limit (§14.1).
 *
 * A rejected request does not extend the window — otherwise a client hammering the
 * endpoint could hold itself locked out indefinitely, which is a worse failure than the
 * one being prevented.
 */
export function rateLimitDecision(
  entry: RateLimitEntry | undefined,
  nowMs: number,
  limit: number,
  windowMs: number,
): RateLimitDecision {
  if (!entry || nowMs - entry.windowStart >= windowMs) {
    return { allowed: true, retryAfterSeconds: 0, entry: { count: 1, windowStart: nowMs } };
  }

  if (entry.count < limit) {
    return {
      allowed: true,
      retryAfterSeconds: 0,
      entry: { count: entry.count + 1, windowStart: entry.windowStart },
    };
  }

  const remainingMs = entry.windowStart + windowMs - nowMs;
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
    entry,
  };
}

/**
 * Drop entries whose window closed more than 15 minutes ago, so the rate-limit document
 * stays bounded (§14.1) — the same discipline §9 applies to `pinAttempts`.
 */
export function pruneRateLimits(
  entries: Record<string, RateLimitEntry>,
  nowMs: number,
  maxAgeMs: number = RATE_LIMIT_PRUNE_MS,
): Record<string, RateLimitEntry> {
  const kept: Record<string, RateLimitEntry> = {};
  for (const [key, entry] of Object.entries(entries)) {
    if (nowMs - entry.windowStart <= maxAgeMs) kept[key] = entry;
  }
  return kept;
}
