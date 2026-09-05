import "server-only";
import { serverEnv } from "@/lib/env";
import { isEntitled, resolveBillingEnabled } from "@/lib/orders/entitlement";
import { adminDb } from "@/lib/server/admin";
import { ApiError } from "@/lib/server/errors";
import { toBilling } from "@/lib/server/firestore";
import { privateRef } from "@/lib/server/shops";
import type { Shop } from "@/lib/types";

/**
 * Entitlement gate (§15). Applied to `add` only — the other actions operate on orders
 * that already exist, and `unclear` restores one rather than creating one, so none of
 * them is ever gated.
 */

const FLAGS_TTL_MS = 60_000;
let flagsCache: { value: boolean | undefined; at: number } | null = null;

/** Test seam. */
export function resetFlagsCache(): void {
  flagsCache = null;
}

/**
 * `config/flags.billingEnabled` overrides the env var (§17). Cached for 60 s, which is
 * both what §17 promises ("changes behaviour within 60 s without a deploy") and what
 * keeps this off the per-request read path.
 *
 * A failed read falls back to the env var rather than throwing: billing is a commercial
 * gate, not a security one, and taking every shop's `add` offline because one config
 * read failed would be the worse outcome.
 */
export async function billingEnabled(nowMs: number = Date.now()): Promise<boolean> {
  const fromEnv = serverEnv().BILLING_ENABLED;

  if (!flagsCache || nowMs - flagsCache.at > FLAGS_TTL_MS) {
    try {
      const snap = await adminDb().collection("config").doc("flags").get();
      const raw = snap.exists ? snap.data()?.billingEnabled : undefined;
      flagsCache = { value: typeof raw === "boolean" ? raw : undefined, at: nowMs };
    } catch (err) {
      console.error("could not read config/flags; falling back to BILLING_ENABLED", err);
      flagsCache = { value: undefined, at: nowMs };
    }
  }

  return resolveBillingEnabled(flagsCache.value, fromEnv);
}

export async function requireEntitled(shop: Shop, nowMs: number = Date.now()): Promise<void> {
  const enabled = await billingEnabled(nowMs);
  // Flag off is the pilot default: no billing document read at all.
  if (!enabled) return;

  if (shop.isPilot) return;

  const snap = await privateRef(shop.id, "billing").get();
  const billing = snap.exists ? toBilling(snap.data()!) : null;

  const result = isEntitled(enabled, shop, billing, nowMs);
  if (!result.ok) {
    throw new ApiError(402, "subscription_required", { status: result.status });
  }
}
