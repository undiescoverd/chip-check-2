import type { Billing, Shop } from "@/lib/types";

/**
 * Entitlement (§15) — pure, so the whole matrix is unit-tested with no network.
 *
 * Phase 1 only ever exercises the flag-off path (billing lands in Phase 5), but the
 * matrix is cheap to state now and the `add` route needs the hook in place regardless.
 */

/** Grace period after a failed payment before `add` starts refusing (§15). */
export const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export type Entitlement =
  | { ok: true }
  | { ok: false; code: "subscription_required"; status: Billing["status"] };

export function isEntitled(
  billingEnabled: boolean,
  shop: Pick<Shop, "isPilot">,
  billing: Billing | null,
  nowMs: number,
): Entitlement {
  if (!billingEnabled) return { ok: true };
  if (shop.isPilot) return { ok: true };

  const status = billing?.status ?? "none";

  if (status === "pilot" || status === "trialing" || status === "active") return { ok: true };

  if (
    status === "past_due" &&
    billing?.pastDueSince != null &&
    nowMs - billing.pastDueSince < PAST_DUE_GRACE_MS
  ) {
    return { ok: true };
  }

  return { ok: false, code: "subscription_required", status };
}

/**
 * `config/flags.billingEnabled` overrides the env var when present (§17), so the flag
 * can be flipped in the Firestore console without a deploy.
 */
export function resolveBillingEnabled(
  flagValue: boolean | undefined | null,
  envValue: boolean,
): boolean {
  return flagValue ?? envValue;
}
