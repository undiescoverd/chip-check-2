import "server-only";
import type { DocumentData } from "firebase-admin/firestore";
import {
  DEFAULT_SETTINGS,
  SettingsSchema,
  type Billing,
  type ClearedBy,
  type Order,
  type OrderStatus,
  type Settings,
  type Shop,
} from "@/lib/types";

/**
 * The Firestore boundary: `Timestamp` in, epoch milliseconds out (see `lib/types.ts`).
 * Everything above this file works in plain data.
 */

/**
 * A field written with `FieldValue.serverTimestamp()` reads back as null until Firestore
 * resolves it, so null is a normal value here, not a bug.
 */
export function toMillis(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  const maybe = value as { toMillis?: () => number };
  return typeof maybe.toMillis === "function" ? maybe.toMillis() : null;
}

export function toOrder(id: string, data: DocumentData): Order {
  return {
    id,
    orderNumber: String(data.orderNumber ?? ""),
    status: (data.status === "ready" ? "ready" : "preparing") as OrderStatus,
    createdAt: toMillis(data.createdAt),
    readyAt: toMillis(data.readyAt),
    cleared: data.cleared === true,
    clearedAt: toMillis(data.clearedAt),
    clearedBy: (data.clearedBy ?? null) as ClearedBy,
  };
}

/**
 * Settings are merged over the §9 defaults before validation, so a shop document written
 * by an earlier version — or by Phase 2 before every field exists — still yields a usable
 * shop. A document that fails validation even after merging falls back to defaults and is
 * logged: refusing to serve the shop at all would take a whole board offline over a bad
 * `timezone` string.
 */
function toSettings(shopId: string, raw: unknown): Settings {
  const parsed = SettingsSchema.safeParse({
    ...DEFAULT_SETTINGS,
    ...(typeof raw === "object" && raw !== null ? raw : {}),
  });
  if (parsed.success) return parsed.data;

  console.error(`shops/${shopId} has invalid settings; falling back to defaults`, parsed.error.issues);
  return DEFAULT_SETTINGS;
}

export function toShop(id: string, data: DocumentData): Shop {
  return {
    id,
    name: String(data.name ?? ""),
    slug: String(data.slug ?? ""),
    ownerUid: String(data.ownerUid ?? ""),
    createdAt: toMillis(data.createdAt),
    settings: toSettings(id, data.settings),
    isPilot: data.isPilot === true,
  };
}

export function toBilling(data: DocumentData): Billing {
  return {
    status: (data.status ?? "none") as Billing["status"],
    stripeCustomerId: data.stripeCustomerId,
    stripeSubscriptionId: data.stripeSubscriptionId,
    currentPeriodEnd: toMillis(data.currentPeriodEnd),
    pastDueSince: toMillis(data.pastDueSince),
    updatedAt: toMillis(data.updatedAt),
  };
}
