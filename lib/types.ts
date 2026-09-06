import { z } from "zod";

/**
 * Domain types (§9).
 *
 * Timestamps are **epoch milliseconds** everywhere above the Firestore layer, not
 * `Timestamp` objects. Two reasons: the decision logic in `lib/orders/rules.ts` stays
 * pure and unit-testable without importing firebase-admin, and JSON responses need a
 * wire format anyway. `lib/server/orders.ts` converts at the boundary.
 *
 * A millisecond field is `null` when Firestore has not resolved it yet — a document
 * read back inside the same tick as its `serverTimestamp()` write has a null there.
 * Every consumer must handle null rather than assuming a number.
 */

export type OrderStatus = "preparing" | "ready";

/** Which code path cleared an order. Only `"staff"` clears are undoable (§13). */
export type ClearedBy = "staff" | "purge" | "clearAll" | null;

export type BillingStatus =
  | "pilot"
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";

/**
 * The settings fields without the cross-field rule.
 *
 * Exported separately because zod refuses `.partial()` on an object carrying
 * refinements, and `PATCH /api/shops/{id}` takes a partial settings patch (§13). The
 * patch is merged over the shop's stored settings and then validated with the refined
 * `SettingsSchema`, so the min/max rule is still enforced on the result — it just cannot
 * be enforced on a fragment, where it would be meaningless.
 */
export const SettingsObject = z.object({
  ticketMinDigits: z.number().int().min(1).max(6).default(1),
  ticketMaxDigits: z.number().int().min(1).max(6).default(4),
  readyTimeoutSeconds: z.number().int().min(30).max(3600).default(300),
  targetPrepSeconds: z.number().int().min(60).max(3600).default(480),
  soundEnabled: z.boolean().default(false),
  timezone: z.string().min(1).default("Europe/London"),
});

export const SettingsSchema = SettingsObject.refine(
  (s) => s.ticketMaxDigits >= s.ticketMinDigits,
  {
    message: "ticketMaxDigits must be >= ticketMinDigits",
    path: ["ticketMaxDigits"],
  },
);

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  ticketMinDigits: 1,
  ticketMaxDigits: 4,
  readyTimeoutSeconds: 300,
  targetPrepSeconds: 480,
  soundEnabled: false,
  timezone: "Europe/London",
};

export interface Shop {
  id: string;
  name: string;
  slug: string;
  ownerUid: string;
  createdAt: number | null;
  settings: Settings;
  isPilot: boolean;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  createdAt: number | null;
  readyAt: number | null;
  cleared: boolean;
  clearedAt: number | null;
  clearedBy: ClearedBy;
}

export interface Billing {
  status: BillingStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodEnd?: number | null;
  pastDueSince?: number | null;
  updatedAt?: number | null;
}

/** The uniqueness lock at `shops/{shopId}/activeNumbers/{orderNumber}` (§9). */
export interface ActiveNumber {
  orderId: string;
  createdAt: number | null;
}
