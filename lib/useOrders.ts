"use client";

import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/lib/firebase/client";
import { SERVER_SILENCE_MS, deriveStatus, type ConnectionStatus } from "@/lib/orders/connection";
import {
  addKey,
  emptyPending,
  mergeOrders,
  overlayOrders,
  pendingKeys,
  reconcilePending,
  applyServerOrder as applyServerOrderTo,
  clearPending as clearPendingIn,
  markPending as markPendingIn,
  emptyPending as freshPending,
  type PendingState,
} from "@/lib/orders/pending";
import type { Order, OrderStatus, ClearedBy } from "@/lib/types";

/**
 * The realtime order list (§11) with the optimistic overlay (§12).
 *
 * The judgement lives next door in `lib/orders/connection.ts` and `lib/orders/pending.ts`,
 * both pure and both unit-tested. This file is the wiring: it subscribes, gathers the
 * browser signals those functions need, and re-evaluates on a tick.
 *
 * Reads are unauthenticated by design — `firestore.rules` makes the active order list
 * public and never references `request.auth` (§10, §7.1). Writes never happen here; they
 * go through the Route Handler.
 */

export type { ConnectionStatus };

export interface UseOrdersResult {
  orders: Order[];
  status: ConnectionStatus;
  loading: boolean;
  /** Keys currently in flight — an order id, or `add:{orderNumber}` (§12). */
  pending: Set<string>;
  markPending: (key: string) => void;
  clearPending: (key: string) => void;
  /** Apply a row the server returned, so it shows before the snapshot catches up. */
  upsertLocal: (order: Order) => void;
}

/** How often to re-evaluate the time-based rules: the 5 s pending cap and 60 s silence. */
const TICK_MS = 1_000;

function toOrder(doc: QueryDocumentSnapshot<DocumentData>): Order {
  const data = doc.data();
  // Timestamps become epoch milliseconds at this boundary, matching the server's wire
  // format (`lib/server/firestore.ts`) so both sides of the app speak the same shape.
  const millis = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return value;
    const maybe = value as { toMillis?: () => number };
    return typeof maybe.toMillis === "function" ? maybe.toMillis() : null;
  };

  return {
    id: doc.id,
    orderNumber: String(data.orderNumber ?? ""),
    status: (data.status === "ready" ? "ready" : "preparing") as OrderStatus,
    createdAt: millis(data.createdAt),
    readyAt: millis(data.readyAt),
    cleared: data.cleared === true,
    clearedAt: millis(data.clearedAt),
    clearedBy: (data.clearedBy ?? null) as ClearedBy,
  };
}

export function useOrders(shopId: string): UseOrdersResult {
  const [snapshotOrders, setSnapshotOrders] = useState<Order[]>([]);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [fromCache, setFromCache] = useState(true);
  const [errored, setErrored] = useState(false);
  const [pendingState, setPendingState] = useState<PendingState>(emptyPending);

  // Advanced by the tick and by browser events. The value is never read — it exists only
  // to force the re-render in which `status` below is recomputed. Without it the
  // elapsed-time rules (the 60 s silence, the 5 s pending cap) would never fire while the
  // app sat idle, which is exactly when they matter.
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  // Not state: writing it must not re-render, and the status derivation reads it through
  // the render that the snapshot already triggers.
  const lastServerContactAt = useRef<number>(Date.now());

  // The tick below needs the current snapshot to reconcile against, but must not be torn
  // down and recreated every time one arrives — a rebuilt interval restarts its timer,
  // so a steady stream of snapshots could starve it. A ref keeps the interval stable.
  const latestOrders = useRef<Order[]>([]);

  useEffect(() => {
    latestOrders.current = [];
    setSnapshotOrders([]);
    setHasSnapshot(false);
    setFromCache(true);
    setErrored(false);
    setPendingState(freshPending());
    lastServerContactAt.current = Date.now();

    const q = query(
      collection(db(), "shops", shopId, "orders"),
      where("cleared", "==", false),
      orderBy("createdAt", "asc"),
    );

    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => {
        const orders = snap.docs.map(toOrder);
        const now = Date.now();

        if (!snap.metadata.fromCache) lastServerContactAt.current = now;

        latestOrders.current = orders;
        setSnapshotOrders(orders);
        setFromCache(snap.metadata.fromCache);
        setHasSnapshot(true);
        setErrored(false);
        // Confirmed state has arrived, so retire whatever it confirms (§12).
        setPendingState((state) => reconcilePending(state, orders, now));
      },
      () => {
        // Firestore does not tell us why, and the client cannot act on it either way;
        // §14's discipline is that the user sees a state, not a stack trace.
        setErrored(true);
      },
    );

    return unsubscribe;
  }, [shopId]);

  // The 60 s silence rule and the 5 s pending cap are both elapsed-time conditions, so
  // something has to re-evaluate them when no snapshot is arriving. That is this.
  useEffect(() => {
    const id = setInterval(() => {
      setPendingState((state) => reconcilePending(state, latestOrders.current, Date.now()));
      bump();
    }, TICK_MS);
    return () => clearInterval(id);
  }, [bump]);

  // §11: connectivity and visibility changes re-evaluate immediately rather than waiting
  // for the next tick — coming back from a locked screen should not show a stale dot for
  // a second.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("online", bump);
    window.addEventListener("offline", bump);
    document.addEventListener("visibilitychange", bump);
    return () => {
      window.removeEventListener("online", bump);
      window.removeEventListener("offline", bump);
      document.removeEventListener("visibilitychange", bump);
    };
  }, [bump]);

  const markPending = useCallback((key: string) => {
    setPendingState((state) => markPendingIn(state, key, Date.now()));
  }, []);

  const clearPending = useCallback((key: string) => {
    setPendingState((state) => clearPendingIn(state, key));
  }, []);

  /**
   * §11 gives this the signature `upsertLocal(order)`, so the key is resolved here rather
   * than asked of every caller. An `add` is in flight under `add:{orderNumber}` because
   * the row had no id when it started; everything else is already keyed by the id the
   * server just echoed back.
   */
  const upsertLocal = useCallback((order: Order) => {
    setPendingState((state) => {
      const key = state.entries[addKey(order.orderNumber)]
        ? addKey(order.orderNumber)
        : order.id;
      return applyServerOrderTo(state, key, order);
    });
  }, []);

  const orders = useMemo(
    () => mergeOrders(snapshotOrders, overlayOrders(pendingState), Date.now()),
    [snapshotOrders, pendingState],
  );

  // Deliberately not memoised. Half the inputs are mutable values a dependency array
  // cannot see — `Date.now()`, a ref, and two browser globals — so any deps list would
  // either be wrong or need a lint suppression to look right. `deriveStatus` is a handful
  // of comparisons; recomputing it each render is cheaper than the bug a stale memo hides.
  // The tick above is what guarantees those renders happen while nothing else changes.
  const status = deriveStatus({
    errored,
    hasSnapshot,
    fromCache,
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    visible: typeof document === "undefined" ? true : document.visibilityState === "visible",
    lastServerContactAt: lastServerContactAt.current,
    nowMs: Date.now(),
  });

  return {
    orders,
    status,
    loading: !hasSnapshot,
    pending: useMemo(() => pendingKeys(pendingState), [pendingState]),
    markPending,
    clearPending,
    upsertLocal,
  };
}

export { addKey, SERVER_SILENCE_MS };
