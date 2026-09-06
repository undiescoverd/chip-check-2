import { describe, expect, it } from "vitest";
import { RATE_LIMITS } from "@/lib/orders/rules";
import { applyRateLimit, readBuckets, type Buckets } from "@/lib/server/rateLimit";

const NOW = 1_700_000_000_000;
const STALE = NOW - 20 * 60 * 1000;
const { limit, windowMs } = RATE_LIMITS.add;

function apply(buckets: Buckets, ipHash = "ip-a", nowMs = NOW) {
  return applyRateLimit(buckets, "add", ipHash, nowMs, limit, windowMs);
}

describe("readBuckets", () => {
  it("reads both known buckets and ignores anything else", () => {
    const parsed = readBuckets({
      add: { a: { count: 1, windowStart: NOW } },
      clearAll: { b: { count: 2, windowStart: NOW } },
      somethingElse: { c: 1 },
    });
    expect(Object.keys(parsed).sort()).toEqual(["add", "clearAll"]);
  });

  it("survives a missing or malformed document", () => {
    expect(readBuckets(undefined)).toEqual({});
    expect(readBuckets(null)).toEqual({});
    expect(readBuckets({ add: "nonsense" })).toEqual({});
  });
});

describe("applyRateLimit", () => {
  it("records the first request for an IP", () => {
    const result = apply({});
    expect(result.allowed).toBe(true);
    expect(result.buckets.add).toEqual({ "ip-a": { count: 1, windowStart: NOW } });
  });

  it("drops entries whose window closed over 15 minutes ago", () => {
    // The returned object is written with a full `set`, not a merge — Firestore merges
    // nested maps recursively, so a merged write would resurrect exactly these entries
    // and the document would grow without bound.
    const result = apply({ add: { old: { count: 9, windowStart: STALE } } });
    expect(result.buckets.add).not.toHaveProperty("old");
  });

  it("keeps other IPs' live entries intact", () => {
    const result = apply({ add: { "ip-b": { count: 4, windowStart: NOW } } });
    expect(result.buckets.add?.["ip-b"]).toEqual({ count: 4, windowStart: NOW });
    expect(result.buckets.add?.["ip-a"]).toEqual({ count: 1, windowStart: NOW });
  });

  it("carries the untouched bucket through, pruned", () => {
    // The write replaces the whole document, so the other bucket must come along or it
    // would be silently wiped by an unrelated request.
    const result = apply({
      clearAll: {
        live: { count: 1, windowStart: NOW },
        dead: { count: 1, windowStart: STALE },
      },
    });
    expect(result.buckets.clearAll).toEqual({ live: { count: 1, windowStart: NOW } });
  });

  it("refuses once the IP is at the limit", () => {
    const result = apply({ add: { "ip-a": { count: limit, windowStart: NOW } } });
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("does not count a refused request against the window", () => {
    const entry = { count: limit, windowStart: NOW };
    const result = apply({ add: { "ip-a": entry } }, "ip-a", NOW + 10_000);
    expect(result.buckets.add?.["ip-a"]).toEqual(entry);
  });

  it("limits per IP, not per shop — a busy neighbour cannot lock out a tablet", () => {
    const result = apply({ add: { "ip-b": { count: limit, windowStart: NOW } } }, "ip-a");
    expect(result.allowed).toBe(true);
  });

  it("does not mutate the input buckets", () => {
    const buckets: Buckets = { add: { "ip-a": { count: 1, windowStart: NOW } } };
    apply(buckets);
    expect(buckets.add?.["ip-a"]).toEqual({ count: 1, windowStart: NOW });
  });
});
