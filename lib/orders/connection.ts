/**
 * Connection status derivation for the realtime listener (§11).
 *
 * Pure, and deliberately so. This is the logic behind the header's "Live" / "Reconnecting"
 * dot, and §28b calls it out as subtle: Firestore's backoff can leave a tab happily
 * serving cached documents with no error and no server contact, so a naive
 * `error ? disconnected : connected` reads "Live" while the board silently goes stale.
 * That is the exact failure the dot exists to catch — a Phase 3 Definition of Done item
 * spells it out ("writes would still succeed over HTTP, so without the dot the tablet
 * looks healthy while its list goes stale").
 *
 * Nothing here imports Firestore or touches `window`. The hook in `lib/useOrders.ts`
 * gathers the inputs and calls this.
 */

/** Same union as v1, so the display and console headers are unchanged (§11). */
export type ConnectionStatus = "connecting" | "connected" | "disconnected";

/**
 * How long a *visible* tab may go without a server-sourced snapshot before we stop
 * claiming to be live (§11). Only applies while visible: a backgrounded tab legitimately
 * receives nothing, and calling that "disconnected" would cry wolf every time someone
 * switches apps.
 */
export const SERVER_SILENCE_MS = 60_000;

export interface StatusInput {
  /** The listener's error callback has fired. */
  errored: boolean;
  /** Any snapshot at all has arrived — cache or server. */
  hasSnapshot: boolean;
  /** `metadata.fromCache` of the most recent snapshot. */
  fromCache: boolean;
  /** `navigator.onLine`. */
  online: boolean;
  /** `document.visibilityState === "visible"`. */
  visible: boolean;
  /**
   * When we last heard from the server: the most recent non-cache snapshot, falling back
   * to when the subscription started. Never null, so the silence rule has a reference
   * point even when no server snapshot has ever arrived.
   */
  lastServerContactAt: number;
  nowMs: number;
}

export function deriveStatus(input: StatusInput): ConnectionStatus {
  // An errored subscription is not "connecting", even if it failed before the first
  // snapshot. §11 lists the error callback as a disconnected condition without
  // qualification, and reporting "connecting" forever would be a lie.
  if (input.errored) return "disconnected";

  if (!input.hasSnapshot) return "connecting";

  // Serving cache with no network is the unambiguous case.
  if (input.fromCache && !input.online) return "disconnected";

  // The silent case: still "online" by the browser's reckoning, no error, but nothing
  // from the server for a minute while the user is looking at it.
  if (input.visible && input.nowMs - input.lastServerContactAt >= SERVER_SILENCE_MS) {
    return "disconnected";
  }

  // Cache-sourced snapshots while online and recently in contact are normal — Firestore
  // serves them between server pushes.
  return "connected";
}
