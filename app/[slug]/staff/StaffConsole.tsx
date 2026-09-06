"use client";

import { Alert, Button, Spinner } from "@nextui-org/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Keypad } from "@/components/staff/Keypad";
import { OrderCard } from "@/components/staff/OrderCard";
import {
  ClearAllModal,
  DuplicateModal,
  SubscriptionModal,
} from "@/components/staff/StaffModals";
import {
  duplicateOrder,
  lockStaff,
  postOrderAction,
  type ApiResult,
  type OrderAction,
} from "@/lib/api";
import { shedCount, shedFilters, shedMinutes } from "@/lib/orders/shed";
import type { Order } from "@/lib/types";
import { addKey, useOrders } from "@/lib/useOrders";
import { useShop } from "../ShopProvider";

/**
 * The staff console (§22.2), a port of v1's `app/staff/page.tsx`.
 *
 * What the port adds, all of it specified: the Live/Reconnecting dot (v1 destructured
 * `{ orders, loading }` and dropped `status`, which is the nastiest failure mode in the
 * product — writes go over HTTP, so a tablet whose listener has gone stale returns clean
 * 200s while its board silently diverges from the other tablet's), the order age, the
 * undo affordance after `clear`, the shed nudge, and a real pending overlay (§12).
 *
 * Classes are verbatim from §22.2 — the screen is pixel-compared against v1 at 390, 768,
 * 1024 and 1280.
 */

/**
 * How long the undo offer stands (§22.2). Ten seconds rather than five: greasy hands
 * under pressure, and WCAG 2.2.1 discourages a short purely-timed window for recovering
 * a destructive action. The server's own window is 60 s (§13), so the console never
 * offers an undo the server will refuse.
 */
const NOTICE_MS = 10_000;

/**
 * The single alert slot above the columns. One slot, three things it can hold — §22.2
 * puts the undo alert "in the same slot as the error alert", and two stacked alerts on a
 * tablet would push the keypad down mid-service.
 */
type Notice =
  | { kind: "error"; message: string }
  | { kind: "undo"; order: Order }
  | { kind: "status"; message: string };

type ModalState = { kind: "clearAll" | "shed" } | null;

export function StaffConsole() {
  const router = useRouter();
  const { shopId, slug, name, settings } = useShop();
  const { orders, status, loading, pending, markPending, clearPending, upsertLocal } =
    useOrders(shopId);

  const [value, setValue] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [duplicate, setDuplicate] = useState<Order | null>(null);
  const [subscription, setSubscription] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [clearing, setClearing] = useState(false);

  /**
   * The synchronous half of the double-tap guard. `pending` disables the buttons, but
   * only from the *next* render — two taps inside one frame would both see the old set
   * and both fire. This ref is written before the fetch, so the second tap is refused
   * whatever React has painted.
   */
  const inFlight = useRef<Set<string>>(new Set());

  // §22.2's order age and shed nudge are elapsed-time rules, and `useOrders` already
  // re-renders once a second for §11's silence check — so they recompute for free. A
  // second timer here (the spec suggests 2 s) would tick strictly less often than the
  // renders already happening, which is the "no per-card timers" point either way.
  const nowMs = Date.now();

  useEffect(() => {
    if (!notice || notice.kind === "error") return;
    const id = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice]);

  const { ticketMinDigits, ticketMaxDigits, readyTimeoutSeconds, targetPrepSeconds } = settings;
  const validLength = value.length >= ticketMinDigits && value.length <= ticketMaxDigits;
  const addPending = pending.has(addKey(value));
  const sheddable = shedCount(orders, readyTimeoutSeconds, nowMs);
  const connected = status === "connected";

  /**
   * Every mutation goes through here: mark pending, send, apply what the server returned
   * so the row flips before the snapshot catches up (§12). Returns `null` when the key is
   * already in flight, which is the whole of the double-tap fix.
   *
   * `clearPending` on failure only — on success the entry is retired by the snapshot that
   * confirms it, or by the 5 s cap.
   */
  async function send(
    body: { action: OrderAction } & Record<string, unknown>,
    key: string,
  ): Promise<ApiResult<{ order?: Order; cleared?: number }> | null> {
    if (inFlight.current.has(key)) return null;
    inFlight.current.add(key);
    markPending(key);

    try {
      const result = await postOrderAction(shopId, body);

      if (!result.ok) {
        clearPending(key);
        // 401 means the cookie expired or was cleared: the server component renders the
        // gate on the next pass, so there is nothing to tell the user in an alert.
        if (result.error.status === 401) router.refresh();
      } else if (result.data.order) {
        upsertLocal(result.data.order);
      }

      return result;
    } finally {
      inFlight.current.delete(key);
    }
  }

  /** Any mutation dismisses whatever the alert slot is holding (§22.2). */
  function beginMutation() {
    setNotice(null);
  }

  async function add() {
    if (!validLength || addPending) return;
    const orderNumber = value;
    beginMutation();

    const result = await send({ action: "add", orderNumber }, addKey(orderNumber));
    if (!result) return;

    if (result.ok) {
      setValue("");
      return;
    }

    if (result.error.status === 401) return;

    // No client-side duplicate pre-check (§22.2): the server's lock is the only thing
    // that can answer this without a race, so the 409 *is* the check.
    if (result.error.code === "duplicate_order") {
      const existing = duplicateOrder(result.error);
      if (existing) {
        setDuplicate(existing);
        return;
      }
    }

    if (result.error.code === "subscription_required") {
      setSubscription(true);
      return;
    }

    setNotice({ kind: "error", message: result.error.message });
  }

  async function change(order: Order, action: "markReady" | "recall" | "clear") {
    beginMutation();

    const result = await send({ action, id: order.id }, order.id);
    if (!result) return;

    if (!result.ok) {
      if (result.error.status !== 401) {
        setNotice({ kind: "error", message: result.error.message });
      }
      return;
    }

    // The clear is soft (§13), so undo is nearly free — and this is the one action staff
    // fat-finger on a wet tablet a hundred times a service. A confirmation dialog would
    // be the wrong fix: it taxes the most-repeated action to guard the rarest mistake.
    if (action === "clear") {
      setNotice({ kind: "undo", order: result.data.order ?? order });
    }
  }

  async function undo(order: Order) {
    beginMutation();

    const result = await send({ action: "unclear", id: order.id }, order.id);
    if (!result) return;

    if (result.ok) {
      setNotice({ kind: "status", message: "Undone" });
      return;
    }

    if (result.error.status === 401) return;
    // `duplicate_order` here means the number went active again; `invalid_transition`
    // means the server's 60 s window closed. Both map to their own copy (§23), and
    // neither re-inserts the row locally (§12).
    setNotice({ kind: "error", message: result.error.message });
  }

  async function confirmClearAll() {
    if (!modal) return;
    const scope = modal.kind;
    beginMutation();
    setClearing(true);

    const result = await postOrderAction(shopId, {
      action: "clearAll",
      ...(scope === "shed" ? shedFilters(readyTimeoutSeconds) : {}),
    });

    setClearing(false);
    setModal(null);

    if (!result.ok) {
      if (result.error.status === 401) {
        router.refresh();
        return;
      }
      setNotice({ kind: "error", message: result.error.message });
    }
  }

  async function changePin() {
    await lockStaff(slug);
    router.refresh();
  }

  const headerLink =
    "font-display text-xs font-extrabold uppercase tracking-wider text-muted-gray whitespace-nowrap";

  return (
    <main className="min-h-screen lg:h-screen lg:overflow-hidden safe-pad safe-pad-md-6 flex flex-col gap-4 lg:gap-6 bg-canvas text-white">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl sm:text-3xl font-extrabold uppercase tracking-wide">
          {`${name} — Staff`}
        </h1>
        <div className="flex items-center gap-6">
          <a href={`/${slug}/display`} className={headerLink}>
            Display →
          </a>
          <button type="button" onClick={changePin} className={headerLink}>
            Change PIN
          </button>
          <div className="flex items-center gap-2">
            <span
              data-testid="connection-dot"
              data-status={status}
              className={`w-2.5 h-2.5 rounded-full ${connected ? "bg-ready" : "bg-preparing"}`}
            />
            <span className={headerLink}>{connected ? "Live" : "Reconnecting"}</span>
          </div>
        </div>
      </header>

      {notice?.kind === "error" && (
        <Alert
          color="danger"
          title={notice.message}
          isClosable
          onClose={() => setNotice(null)}
        />
      )}
      {notice?.kind === "undo" && (
        <Alert
          role="status"
          color="default"
          title={`Cleared #${notice.order.orderNumber}`}
          isClosable
          onClose={() => setNotice(null)}
          endContent={
            <Button size="sm" variant="flat" onPress={() => undo(notice.order)}>
              Undo
            </Button>
          }
        />
      )}
      {notice?.kind === "status" && (
        <Alert
          role="status"
          color="default"
          title={notice.message}
          isClosable
          onClose={() => setNotice(null)}
        />
      )}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch lg:gap-8 lg:flex-1 lg:min-h-0">
        <section className="flex flex-col items-center gap-4 lg:h-full lg:w-[380px] xl:w-[440px] lg:shrink-0 lg:items-stretch">
          <input
            inputMode="numeric"
            placeholder="Order number"
            aria-label="Order number"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, ticketMaxDigits))}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            className="w-full sm:max-w-xs lg:max-w-none lg:shrink-0 h-20 lg:h-28 rounded-2xl bg-canvas-elevated text-center font-display text-5xl lg:text-7xl font-black tabular-nums text-white placeholder:text-base placeholder:font-sans placeholder:font-normal placeholder:text-muted-gray outline-none focus:ring-2 focus:ring-white/20"
          />
          <Keypad value={value} onChange={setValue} maxDigits={ticketMaxDigits} />
          <button
            type="button"
            disabled={!validLength || addPending}
            onClick={add}
            className="h-14 lg:h-16 lg:shrink-0 w-full sm:max-w-xs lg:max-w-none rounded-2xl bg-white text-canvas font-display text-lg lg:text-2xl font-extrabold uppercase tracking-wide disabled:opacity-40"
          >
            {addPending ? "Adding…" : "+ Add Order"}
          </button>
        </section>

        <section className="flex flex-col gap-3 lg:h-full lg:min-h-0 lg:min-w-0 lg:flex-1">
          <div className="flex items-center justify-between lg:shrink-0">
            <h2 className="font-display text-sm font-extrabold uppercase tracking-wider text-muted-gray lg:text-base">
              Active Orders
            </h2>
            <div className="flex items-center gap-4">
              <span className="font-display text-xs font-extrabold uppercase tracking-wider text-muted-gray lg:text-sm">
                {loading ? "" : `${orders.length} in queue`}
              </span>
              {sheddable > 0 && (
                <button
                  type="button"
                  data-testid="shed-nudge"
                  onClick={() => setModal({ kind: "shed" })}
                  className="h-11 px-4 rounded-xl bg-white/5 text-muted-gray font-display text-xs font-extrabold uppercase tracking-wider"
                >
                  {`${sheddable} ready over ${shedMinutes(readyTimeoutSeconds)} min — clear?`}
                </button>
              )}
              <button
                type="button"
                disabled={orders.length === 0}
                onClick={() => setModal({ kind: "clearAll" })}
                className="h-11 px-4 rounded-xl bg-white/5 text-muted-gray font-display text-xs font-extrabold uppercase tracking-wider disabled:opacity-30"
              >
                Clear All
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
            {loading && (
              <div className="flex justify-center py-8">
                <Spinner label="Loading orders..." />
              </div>
            )}
            {!loading && orders.length === 0 && (
              <p className="text-center text-empty-muted font-display font-bold text-xl py-8">
                No active orders.
              </p>
            )}
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                busy={pending.has(order.id)}
                targetPrepSeconds={targetPrepSeconds}
                nowMs={nowMs}
                onMarkReady={(o) => change(o, "markReady")}
                onRecall={(o) => change(o, "recall")}
                onClear={(o) => change(o, "clear")}
              />
            ))}
          </div>
        </section>
      </div>

      <DuplicateModal order={duplicate} onClose={() => setDuplicate(null)} />
      <ClearAllModal
        isOpen={modal !== null}
        scope={modal?.kind === "shed" ? "shed" : "all"}
        count={modal?.kind === "shed" ? sheddable : orders.length}
        clearing={clearing}
        onCancel={() => setModal(null)}
        onConfirm={confirmClearAll}
      />
      <SubscriptionModal isOpen={subscription} onClose={() => setSubscription(false)} />
    </main>
  );
}
