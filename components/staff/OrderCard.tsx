"use client";

import { formatAge, ageMs, isOverTarget } from "@/lib/orders/age";
import type { Order } from "@/lib/types";

/**
 * One row of the active list (§22.2), a port of v1's `OrderCard.tsx` with two v2
 * additions, both of which the spec is explicit about:
 *
 *  - the status word is visible at every width (v1 hid it below `sm`, which broke the
 *    Color-Plus-Label Rule on the one device where the row is narrowest);
 *  - the order age, escalating past the shop's prep target as **weight and opacity
 *    inside the row's own colour** — never a new hue (§20, The No-Third-Colour Rule).
 *    The heavier treatment reuses the `bg-black/[0.14]` pill the Clear button already
 *    uses, so the escalation adds no new material to the design.
 *
 * The left group stacks below `sm` so the age never has to be hidden — hiding it at
 * phone width would repeat exactly the mistake the status word fixes.
 *
 * `busy` is the pending set from §12: while a mutation for this order is in flight every
 * button is disabled, which is what stops a double tap from firing twice.
 */
export function OrderCard({
  order,
  busy,
  targetPrepSeconds,
  nowMs,
  onMarkReady,
  onRecall,
  onClear,
}: {
  order: Order;
  busy: boolean;
  targetPrepSeconds: number;
  nowMs: number;
  onMarkReady: (order: Order) => void;
  onRecall: (order: Order) => void;
  onClear: (order: Order) => void;
}) {
  const ready = order.status === "ready";
  const overTarget = isOverTarget(order, targetPrepSeconds, nowMs);
  const age = formatAge(ageMs(order, nowMs));

  const rowText = ready ? "text-ready-text" : "text-preparing-text";
  // The weight is deliberately not in the shared string: Ready/Recall are `font-extrabold`
  // and Clear is `font-bold` (§22.2), and two weight classes on one element resolve by
  // stylesheet order rather than by the order they are written here.
  const actionClasses =
    "h-12 lg:h-14 xl:h-16 min-w-[44px] px-5 lg:px-5 xl:px-7 rounded-xl font-display lg:text-lg xl:text-xl disabled:opacity-50";

  return (
    <div
      data-testid="order-card"
      data-order-number={order.orderNumber}
      data-status={order.status}
      className={`w-full rounded-2xl px-5 py-4 lg:px-6 lg:py-5 xl:px-8 xl:py-6 flex items-center justify-between gap-4 ${
        ready ? "bg-ready text-ready-text" : "bg-preparing text-preparing-text"
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 lg:gap-4 xl:gap-5 min-w-0">
        <span className="font-display text-3xl lg:text-4xl xl:text-5xl font-black tabular-nums truncate">
          {order.orderNumber}
        </span>
        <div className="flex items-center gap-2">
          <span className="font-display text-xs sm:text-sm lg:text-base xl:text-lg font-extrabold uppercase tracking-wider opacity-70">
            {ready ? "Ready" : "Preparing"}
          </span>
          <span
            data-testid="order-age"
            data-over-target={overTarget ? "true" : "false"}
            className={`font-display text-xs sm:text-sm lg:text-base tabular-nums ${
              overTarget
                ? "font-black px-2 py-0.5 rounded-xl bg-black/[0.14]"
                : "font-bold opacity-70"
            }`}
          >
            {age}
          </span>
        </div>
      </div>

      <div className="flex gap-2 lg:gap-3 shrink-0">
        {!ready && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onMarkReady(order)}
            className={`${actionClasses} font-extrabold bg-ready-text text-white`}
          >
            Ready
          </button>
        )}
        {ready && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRecall(order)}
            className={`${actionClasses} font-extrabold bg-preparing-key text-preparing-bright`}
          >
            Recall
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onClear(order)}
          className={`${actionClasses} font-bold bg-black/[0.14] ${rowText}`}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
