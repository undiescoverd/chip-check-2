import { z } from "zod";

/**
 * Orders request body (§13). Same shape as v1 minus `pin` and minus `purgeStale`.
 *
 * `orderNumber` is only checked here for being a string — the digit rule is per shop, so
 * it is re-validated against `settings` after the shop is loaded (§14), producing
 * `invalid_order_number` with the shop's own min/max rather than a generic schema error.
 */
export const DocId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const OrdersBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), orderNumber: z.string() }),
  z.object({ action: z.literal("markReady"), id: DocId }),
  z.object({ action: z.literal("recall"), id: DocId }),
  z.object({ action: z.literal("clear"), id: DocId }),
  // Undo a staff clear (§22.2). Never entitlement-gated, never rate-limited.
  z.object({ action: z.literal("unclear"), id: DocId }),
  z.object({
    action: z.literal("clearAll"),
    status: z.enum(["preparing", "ready"]).optional(),
    olderThanSeconds: z.number().int().min(0).optional(),
  }),
]);

export type OrdersBody = z.infer<typeof OrdersBody>;
