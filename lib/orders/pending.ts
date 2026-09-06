import type { Order } from "@/lib/types";

/**
 * The optimistic overlay (§12).
 *
 * v1 exported an `upsertOrder` from its hook and never called it, so every tap waited a
 * full round trip. v2 keeps the rule deliberately small, because `onSnapshot` already
 * delivers confirmed state in a few hundred milliseconds — the overlay only has to cover
 * that gap.
 *
 * Two invariants carry the whole design, and both are asserted in the tests:
 *
 *  1. **The overlay never invents a row.** It only ever holds an order the *server
 *     returned*. A failed mutation clears its entry and adds nothing — which is what
 *     stops a refused undo from resurrecting a row that is genuinely gone (§12).
 *  2. **The snapshot always wins in the end.** An entry survives only until the snapshot
 *     confirms it or `PENDING_TIMEOUT_MS` elapses. There is no path where a stale overlay
 *     row outlives its welcome and hides the truth.
 *
 * Pure — no Firestore, no timers, no React. The hook supplies `nowMs` and the snapshot.
 */

/**
 * How long an entry may stay pending without confirmation (§12). The cap exists so a
 * dropped snapshot can't leave a button disabled forever; when it fires, the overlay row
 * is discarded and the snapshot's version shows through.
 */
export const PENDING_TIMEOUT_MS = 5_000;

/**
 * `add` is the one action with no order id to key on — the row does not exist yet — so it
 * is keyed by the number being added (§12). Everything else keys on the order's own id,
 * `unclear` included.
 */
export function addKey(orderNumber: string): string {
  return `add:${orderNumber}`;
}

export interface PendingEntry {
  key: string;
  startedAt: number;
  /** The row the server returned, or null while the request is still in flight. */
  order: Order | null;
}

export interface PendingState {
  entries: Record<string, PendingEntry>;
}

export function emptyPending(): PendingState {
  return { entries: {} };
}

/** Mark a key in flight. The buttons for it are disabled from here (§12). */
export function markPending(state: PendingState, key: string, nowMs: number): PendingState {
  return { entries: { ...state.entries, [key]: { key, startedAt: nowMs, order: null } } };
}

/**
 * Attach the row the server returned, so it can show before the snapshot catches up.
 *
 * A no-op if the key is no longer pending: the entry may already have been cleared by an
 * error or the timeout, and re-adding it here would resurrect an overlay the caller has
 * given up on.
 */
export function applyServerOrder(
  state: PendingState,
  key: string,
  order: Order,
): PendingState {
  const existing = state.entries[key];
  if (!existing) return state;
  return { entries: { ...state.entries, [key]: { ...existing, order } } };
}

/** Drop an entry and its overlay row. Used on error, and by the reconciler. */
export function clearPending(state: PendingState, key: string): PendingState {
  if (!state.entries[key]) return state;
  const entries = { ...state.entries };
  delete entries[key];
  return { entries };
}

/**
 * Has the snapshot caught up with what the server told us?
 *
 * The snapshot is filtered to `cleared == false` (§11), so a cleared order does not
 * appear as a cleared row — it simply leaves the list. That asymmetry is why this is not
 * a field-by-field comparison.
 */
export function isConfirmed(overlay: Order, snapshotOrder: Order | undefined): boolean {
  // `clear` and `clearAll`: confirmed once the row is gone from the active list.
  if (overlay.cleared) return snapshotOrder === undefined;

  // `add` and `unclear` expect the row to be present; `markReady` and `recall` expect it
  // present with the new status.
  if (!snapshotOrder) return false;
  return snapshotOrder.status === overlay.status && !snapshotOrder.cleared;
}

/**
 * Drop every entry the snapshot has confirmed, and every entry past the timeout.
 *
 * An entry with no server order yet is only ever dropped by the timeout — the request is
 * still in flight, and there is nothing to confirm against.
 */
export function reconcilePending(
  state: PendingState,
  snapshot: Order[],
  nowMs: number,
): PendingState {
  const byId = new Map(snapshot.map((o) => [o.id, o]));
  const entries: Record<string, PendingEntry> = {};

  for (const entry of Object.values(state.entries)) {
    if (nowMs - entry.startedAt >= PENDING_TIMEOUT_MS) continue;
    if (entry.order && isConfirmed(entry.order, byId.get(entry.order.id))) continue;
    entries[entry.key] = entry;
  }

  return { entries };
}

/** The keys still in flight, for disabling buttons (§12, v1's `busy` prop). */
export function pendingKeys(state: PendingState): Set<string> {
  return new Set(Object.keys(state.entries));
}

/** The server-returned rows still waiting on the snapshot. */
export function overlayOrders(state: PendingState): Order[] {
  return Object.values(state.entries)
    .map((e) => e.order)
    .filter((o): o is Order => o !== null);
}

/** Sort key per §11: `createdAt` ascending, with a caller-supplied fallback for null. */
function sortKey(order: Order, nowMs: number): number {
  return order.createdAt ?? nowMs;
}

/**
 * Merge the snapshot with the overlay for rendering.
 *
 * `nowMs` is passed in rather than read from the clock inside the comparator: a
 * `createdAt` that is still null (a `serverTimestamp()` not yet resolved) would otherwise
 * produce a different sort key on every comparison, and a comparator that is not a
 * consistent ordering can crash or scramble the list.
 */
export function mergeOrders(snapshot: Order[], overlay: Order[], nowMs: number): Order[] {
  const byId = new Map(snapshot.map((o) => [o.id, o]));

  for (const order of overlay) {
    // A cleared row leaves the active list immediately, rather than lingering until the
    // snapshot drops it.
    if (order.cleared) byId.delete(order.id);
    else byId.set(order.id, order);
  }

  return Array.from(byId.values()).sort((a, b) => sortKey(a, nowMs) - sortKey(b, nowMs));
}
