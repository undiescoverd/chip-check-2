import type { Order } from "@/lib/types";

/**
 * The client's side of the API contract (§13, §14) and the code → copy map (§23).
 *
 * Two things live here on purpose:
 *
 *  1. **Every failure becomes a result, never a throw.** The console has to branch on
 *     *which* failure it was — a duplicate opens a modal, a 402 opens a different modal,
 *     a 401 sends the tablet back to the gate — so a rejected promise would only be
 *     unwrapped into this shape at every call site anyway.
 *  2. **The copy is chosen by code *and* action.** §23 maps two codes differently
 *     depending on which action was sent: `duplicate_order` is the duplicate modal from
 *     `add` but "Couldn't undo — #{n} is active again" from `unclear`, and
 *     `invalid_transition` is "That order changed — refresh" from a state change but
 *     "Too late to undo" from `unclear`. The server cannot know which it is; the client
 *     sent the action, so the client maps it.
 *
 * No copy is invented here. Every string is one from §23.
 */

export type OrderAction =
  | "add"
  | "markReady"
  | "recall"
  | "clear"
  | "unclear"
  | "clearAll";

/** The code used when the request never reached a handler (§23: network → copy). */
export const NETWORK_ERROR = "network";

export interface ApiFailure {
  /** The stable server code (§14), or `network`. */
  code: string;
  /** HTTP status, or 0 when the fetch itself failed. */
  status: number;
  /** The rest of the error body — `{ order }`, `{ min, max }`, `{ retryAfterSeconds }`. */
  details: Record<string, unknown>;
  /** The §23 copy for this code and action. */
  message: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiFailure };

/** §23, "staff errors": the fallback when a code has no mapping of its own. */
const ACTION_FALLBACK: Record<OrderAction, string> = {
  add: "Failed to add order",
  markReady: "Failed to mark order ready",
  recall: "Failed to recall order",
  clear: "Failed to clear order",
  // §23 lists no fallback for undo — its real failures (`duplicate_order`,
  // `invalid_transition`, `order_not_found`) all map below, so this covers only the
  // unexpected, which is what "Something went wrong" is for.
  unclear: "Something went wrong",
  clearAll: "Failed to clear all orders",
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function orderNumberFrom(details: Record<string, unknown>): string {
  const order = asRecord(details.order);
  return typeof order.orderNumber === "string" ? order.orderNumber : "";
}

/**
 * The duplicate order the server returned with a 409, if it sent one. The console needs
 * it for the modal body ("Order #{n} is already active ({status})").
 */
export function duplicateOrder(error: ApiFailure): Order | null {
  const order = asRecord(error.details.order);
  return typeof order.id === "string" && typeof order.orderNumber === "string"
    ? (order as unknown as Order)
    : null;
}

/** §23's code → copy map, for the orders route. */
export function orderErrorCopy(
  code: string,
  action: OrderAction,
  details: Record<string, unknown> = {},
): string {
  switch (code) {
    case NETWORK_ERROR:
      return "Couldn't reach the server";

    case "invalid_order_number": {
      const min = Number(details.min);
      const max = Number(details.max);
      if (!Number.isFinite(min) || !Number.isFinite(max)) return ACTION_FALLBACK[action];
      return min === max ? `Enter ${min} digits` : `Enter ${min}–${max} digits`;
    }

    case "duplicate_order":
      if (action === "unclear") {
        return `Couldn't undo — #${orderNumberFrom(details)} is active again`;
      }
      // From `add` this is shown in the duplicate modal rather than the alert, so this
      // is the modal's body copy (§22.2) rather than a second wording of the same fact.
      return `Order #${orderNumberFrom(details)} is already active (${
        asRecord(details.order).status ?? "preparing"
      }). Clear it first, or use a different number.`;

    case "invalid_transition":
      // Undo past the server's 60 s window (§13) comes back as this code.
      return action === "unclear" ? "Too late to undo" : "That order changed — refresh";

    case "order_not_found":
      return "That order was already cleared";

    case "rate_limited":
      return "Slow down a moment";

    case "invalid_json":
    case "invalid_body":
      return "Something went wrong";

    default:
      return ACTION_FALLBACK[action];
  }
}

/** §23's map for the PIN gate (§22.2). */
export function unlockErrorCopy(code: string, details: Record<string, unknown> = {}): string {
  switch (code) {
    case NETWORK_ERROR:
      return "Couldn't reach the server";
    case "invalid_pin":
      return "Wrong PIN";
    case "pin_locked": {
      const seconds = Number(details.retryAfterSeconds);
      const minutes = Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds / 60)) : 1;
      return `Too many attempts — try again in ${minutes} min`;
    }
    default:
      // Covers `shop_not_found` and `invalid_body`, neither of which §23 gives the gate
      // its own copy for (PROGRESS.md deviation 27).
      return "Something went wrong";
  }
}

/**
 * POST a JSON body and normalise the outcome.
 *
 * A non-JSON body from a 500 or a proxy is not a crash: `code` falls back to `internal`
 * and the caller shows the mapped fallback, exactly as for any other unexpected failure.
 */
async function postJson<T>(
  url: string,
  body: unknown,
  copy: (code: string, details: Record<string, unknown>) => string,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      error: { code: NETWORK_ERROR, status: 0, details: {}, message: copy(NETWORK_ERROR, {}) },
    };
  }

  const payload = asRecord(await res.json().catch(() => ({})));

  if (res.ok) return { ok: true, data: payload as T };

  const { error, ...details } = payload;
  const code = typeof error === "string" ? error : "internal";
  return { ok: false, error: { code, status: res.status, details, message: copy(code, details) } };
}

export function postOrderAction(
  shopId: string,
  body: { action: OrderAction } & Record<string, unknown>,
): Promise<ApiResult<{ order?: Order; cleared?: number }>> {
  return postJson(`/api/shops/${encodeURIComponent(shopId)}/orders`, body, (code, details) =>
    orderErrorCopy(code, body.action, details),
  );
}

/**
 * Exchange the PIN for the `cc_staff` cookie (§7.2). Addressed by slug: the tablet is
 * sitting on `/{slug}/staff` and the gate has no shop id (the route's `[shopId]` segment
 * resolves a slug first — PROGRESS.md deviation 21).
 */
export function unlockStaff(
  slug: string,
  pin: string,
): Promise<ApiResult<{ ok: true; expiresAt: number }>> {
  return postJson(
    `/api/shops/${encodeURIComponent(slug)}/staff/unlock`,
    { pin },
    unlockErrorCopy,
  );
}

/** "Change PIN" (§7.2 step 7): drop the cookie and fall back to the gate. */
export async function lockStaff(slug: string): Promise<void> {
  try {
    await fetch(`/api/shops/${encodeURIComponent(slug)}/staff/unlock`, { method: "DELETE" });
  } catch {
    // Nothing useful to say: the button's whole job is to return to the gate, and the
    // page reload that follows re-reads the cookie either way.
  }
}
