"use client";

import { AnimatePresence } from "framer-motion";
import type { Order } from "@/lib/types";
import { OrderTile } from "./OrderTile";

/**
 * A "Preparing" or "Ready · Collect" column (§22.1), a port of v1's `Column.tsx`.
 *
 * `aria-live="polite"` only on the ready column (§25) — a customer's own number moving
 * into Ready is the one change on this screen worth announcing; every other addition and
 * removal is visual noise to a screen reader.
 */
export function Column({
  title,
  orders,
  variant,
  headerClass,
}: {
  title: string;
  orders: Order[];
  variant: "preparing" | "ready";
  headerClass: string;
}) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className={`px-6 py-3 md:px-8 md:py-4 flex items-center justify-between ${headerClass}`}>
        <h2 className="font-display text-xl md:text-3xl font-black uppercase tracking-wider">
          {title}
        </h2>
        <span className="font-display text-xl md:text-3xl font-extrabold tabular-nums">
          {orders.length}
        </span>
      </div>
      <div
        className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6"
        aria-live={variant === "ready" ? "polite" : undefined}
      >
        {orders.length === 0 ? (
          <p className="h-full flex items-center justify-center text-empty-muted font-display font-bold text-2xl md:text-4xl">
            No orders
          </p>
        ) : (
          <div
            className="grid gap-3 md:gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}
          >
            <AnimatePresence>
              {orders.map((order) => (
                <OrderTile key={order.id} order={order} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
