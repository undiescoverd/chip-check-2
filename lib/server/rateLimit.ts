import "server-only";
import {
  pruneRateLimits,
  rateLimitDecision,
  type RateLimitEntry,
} from "@/lib/orders/rules";
import { adminDb } from "@/lib/server/admin";
import { ApiError } from "@/lib/server/errors";
import { hashIp } from "@/lib/server/http";
import { privateRef } from "@/lib/server/shops";

/**
 * Rate limiting (§14.1).
 *
 * State lives in `shops/{shopId}/private/rateLimits` rather than in memory: on Fluid
 * Compute instances come and go, so an in-memory counter guards nothing. Same reasoning
 * and same shape as §9's `pinAttempts`.
 *
 * `add` folds its check into the existing `activeNumbers` transaction (see
 * `lib/server/orders.ts`) so it costs no extra round trip; `clearAll` gets its own
 * transaction because it is the destructive one and runs rarely.
 */

export type BucketName = "add" | "clearAll";

export type Buckets = Partial<Record<BucketName, Record<string, RateLimitEntry>>>;

export function rateLimitsRef(shopId: string) {
  return privateRef(shopId, "rateLimits");
}

export function readBuckets(data: unknown): Buckets {
  if (typeof data !== "object" || data === null) return {};
  const raw = data as Record<string, unknown>;
  const out: Buckets = {};
  for (const name of ["add", "clearAll"] as const) {
    const bucket = raw[name];
    if (typeof bucket === "object" && bucket !== null) {
      out[name] = bucket as Record<string, RateLimitEntry>;
    }
  }
  return out;
}

export interface BucketUpdate {
  allowed: boolean;
  retryAfterSeconds: number;
  /** The complete replacement document — see the note on pruning below. */
  buckets: Buckets;
}

/**
 * Decide, and produce the whole new document.
 *
 * It returns every bucket, not just the one touched, because the write must be a full
 * `set` rather than a merge: Firestore merges nested maps recursively, so a merged write
 * would re-add the very entries pruning just removed and the document would grow without
 * bound. Reading both buckets in the same transaction makes the full replacement safe.
 */
export function applyRateLimit(
  buckets: Buckets,
  name: BucketName,
  ipHash: string,
  nowMs: number,
  limit: number,
  windowMs: number,
): BucketUpdate {
  const pruned = pruneRateLimits(buckets[name] ?? {}, nowMs);
  const decision = rateLimitDecision(pruned[ipHash], nowMs, limit, windowMs);

  const next: Buckets = {};
  for (const other of ["add", "clearAll"] as const) {
    if (other === name) continue;
    if (buckets[other]) next[other] = pruneRateLimits(buckets[other]!, nowMs);
  }
  next[name] = decision.allowed ? { ...pruned, [ipHash]: decision.entry } : pruned;

  return {
    allowed: decision.allowed,
    retryAfterSeconds: decision.retryAfterSeconds,
    buckets: next,
  };
}

/**
 * Standalone consume, used by `clearAll`. Throws 429 without writing when over the limit,
 * so a rejected request never extends its own window.
 */
export async function consumeRateLimit(
  shopId: string,
  name: BucketName,
  ip: string,
  limit: number,
  windowMs: number,
  nowMs: number = Date.now(),
): Promise<void> {
  const ref = rateLimitsRef(shopId);
  const ipHash = hashIp(ip);

  await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const buckets = readBuckets(snap.exists ? snap.data() : {});
    const update = applyRateLimit(buckets, name, ipHash, nowMs, limit, windowMs);

    if (!update.allowed) {
      throw new ApiError(429, "rate_limited", { retryAfterSeconds: update.retryAfterSeconds });
    }
    tx.set(ref, update.buckets);
  });
}
