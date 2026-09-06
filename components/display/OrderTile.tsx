"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { Order } from "@/lib/types";

/**
 * One number on the customer board (§22.1), a port of v1's `OrderTile.tsx`.
 *
 * `layoutId={order.id}` is what makes a tile **slide** from the Preparing column to the
 * Ready one rather than fading out of one and into the other — the two columns share one
 * `LayoutGroup` in `DisplayShell`, and framer-motion resolves the shared layout id across
 * them. `useReducedMotion` (the same convention as `StaffModals`, §24) drops the spring
 * and the scale for a reduced-motion viewer; the tile still appears and disappears, it
 * just does not move to get there.
 */
export function OrderTile({ order }: { order: Order }) {
  const reduced = useReducedMotion();
  const ready = order.status === "ready";

  return (
    <motion.div
      data-testid="order-tile"
      data-order-number={order.orderNumber}
      data-status={order.status}
      layout
      layoutId={order.id}
      initial={reduced ? false : { opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
      transition={
        reduced
          ? { duration: 0 }
          : { type: "spring", stiffness: 350, damping: 28 }
      }
      className={`rounded-2xl px-4 py-4 md:px-6 md:py-6 flex items-center justify-center ${
        ready ? "bg-ready text-ready-text" : "bg-preparing text-preparing-text"
      }`}
    >
      <span className="font-display font-black tabular-nums text-[clamp(1.75rem,5.5vw,4rem)]">
        {order.orderNumber}
      </span>
    </motion.div>
  );
}
