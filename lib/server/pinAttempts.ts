import "server-only";
import { pruneRateLimits, type RateLimitEntry } from "@/lib/orders/rules";
import { adminDb } from "@/lib/server/admin";
import { ApiError } from "@/lib/server/errors";
import { hashIp } from "@/lib/server/http";
import { privateRef } from "@/lib/server/shops";

/**
 * PIN lockout (§7.2 step 3): 5 attempts per 15 minutes, per shop per IP, in Firestore
 * because in-memory counters do not survive Fluid Compute instance churn.
 *
 * This deliberately does NOT reuse `lib/server/rateLimit.ts`. That module is
 * bucket-shaped (`add`/`clearAll` under one document) and counts *accepted* calls;
 * §9 gives `pinAttempts` its own document shape (`attempts: { [sha256(ip)]: … }`) and
 * §7.2 counts *failures* and resets on success. Forcing one abstraction over two
 * different shapes and two opposite semantics would obscure both. The pure window
 * helper — `pruneRateLimits` — is shared, which is the part that actually repeats.
 */

export const PIN_MAX_ATTEMPTS = 5;
export const PIN_WINDOW_MS = 15 * 60 * 1000;

export type Attempts = Record<string, RateLimitEntry>;

export function pinAttemptsRef(shopId: string) {
  return privateRef(shopId, "pinAttempts");
}

export function readAttempts(data: unknown): Attempts {
  if (typeof data !== "object" || data === null) return {};
  const raw = (data as Record<string, unknown>).attempts;
  if (typeof raw !== "object" || raw === null) return {};

  const out: Attempts = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = value as Partial<RateLimitEntry>;
    if (typeof entry?.count === "number" && typeof entry?.windowStart === "number") {
      out[key] = { count: entry.count, windowStart: entry.windowStart };
    }
  }
  return out;
}

export interface LockoutDecision {
  locked: boolean;
  retryAfterSeconds: number;
}

/**
 * Pure: is this key locked out right now? (§7.2 — `count >= 5` AND the window is still
 * open.) An entry whose window has closed is not a lockout, whatever its count.
 */
export function pinLockoutDecision(
  entry: RateLimitEntry | undefined,
  nowMs: number,
  limit: number = PIN_MAX_ATTEMPTS,
  windowMs: number = PIN_WINDOW_MS,
): LockoutDecision {
  if (!entry) return { locked: false, retryAfterSeconds: 0 };

  const elapsed = nowMs - entry.windowStart;
  if (elapsed >= windowMs) return { locked: false, retryAfterSeconds: 0 };
  if (entry.count < limit) return { locked: false, retryAfterSeconds: 0 };

  return {
    locked: true,
    retryAfterSeconds: Math.max(1, Math.ceil((windowMs - elapsed) / 1000)),
  };
}

/**
 * Pure: the attempts map after one failure. A failure inside an open window extends the
 * count but not the window, so repeated wrong PINs cannot hold the caller locked out for
 * longer than 15 minutes from the first one.
 */
export function recordFailure(
  attempts: Attempts,
  key: string,
  nowMs: number,
  windowMs: number = PIN_WINDOW_MS,
): Attempts {
  const pruned = pruneRateLimits(attempts, nowMs, windowMs);
  const existing = pruned[key];

  const entry: RateLimitEntry =
    existing && nowMs - existing.windowStart < windowMs
      ? { count: existing.count + 1, windowStart: existing.windowStart }
      : { count: 1, windowStart: nowMs };

  return { ...pruned, [key]: entry };
}

/**
 * §7.2 step 3, run before the PIN is hashed.
 *
 * The order matters: scrypt at N=2^15 costs ~110 ms, so hashing first would hand an
 * attacker five free CPU-bound operations per window. Throws 429 `pin_locked` without
 * writing — a refused attempt must not extend its own lockout.
 */
export async function assertNotLockedOut(
  shopId: string,
  ip: string,
  nowMs: number = Date.now(),
): Promise<void> {
  const snap = await pinAttemptsRef(shopId).get();
  const attempts = readAttempts(snap.exists ? snap.data() : {});
  const decision = pinLockoutDecision(attempts[hashIp(ip)], nowMs);

  if (decision.locked) {
    throw new ApiError(429, "pin_locked", { retryAfterSeconds: decision.retryAfterSeconds });
  }
}

/** §7.2 step 4, wrong PIN: increment. Written as a full `set` so pruning actually removes. */
export async function recordFailedAttempt(
  shopId: string,
  ip: string,
  nowMs: number = Date.now(),
): Promise<void> {
  const ref = pinAttemptsRef(shopId);
  const key = hashIp(ip);

  await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const attempts = readAttempts(snap.exists ? snap.data() : {});
    // A full set, not a merge: Firestore merges nested maps recursively, so a merged
    // write would resurrect the entries pruning just dropped.
    tx.set(ref, { attempts: recordFailure(attempts, key, nowMs) });
  });
}

/** §7.2 step 4, right PIN: reset this caller's counter. */
export async function clearAttempts(
  shopId: string,
  ip: string,
  nowMs: number = Date.now(),
): Promise<void> {
  const ref = pinAttemptsRef(shopId);
  const key = hashIp(ip);

  await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const attempts = pruneRateLimits(readAttempts(snap.exists ? snap.data() : {}), nowMs, PIN_WINDOW_MS);
    delete attempts[key];
    tx.set(ref, { attempts });
  });
}

/**
 * Wipe every counter for a shop. Called on PIN rotation: Part I risk #12 accepts that
 * one mistyping tablet can lock out a whole shop behind a single NAT address, and names
 * rotation as the owner's way out. That escape hatch only exists if rotation clears this.
 */
export async function resetAllAttempts(shopId: string): Promise<void> {
  await pinAttemptsRef(shopId).set({ attempts: {} });
}
