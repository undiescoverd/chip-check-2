import { describe, expect, it } from "vitest";
import {
  RATE_LIMITS,
  STALE_HOURS,
  UNDO_WINDOW_MS,
  canClear,
  canMarkReady,
  canRecall,
  canUnclear,
  isStale,
  isValidOrderNumber,
  orderNumberPattern,
  pruneRateLimits,
  purgeCutoff,
  rateLimitDecision,
  shouldClearAll,
} from "@/lib/orders/rules";
import { DEFAULT_SETTINGS, type Order, type Settings } from "@/lib/types";

const NOW = 1_700_000_000_000;

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: "order1",
    orderNumber: "0042",
    status: "preparing",
    createdAt: NOW,
    readyAt: null,
    cleared: false,
    clearedAt: null,
    clearedBy: null,
    ...overrides,
  };
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("canMarkReady", () => {
  it("allows a preparing order", () => {
    expect(canMarkReady(order()).ok).toBe(true);
  });

  it("refuses an order that is already ready", () => {
    expect(canMarkReady(order({ status: "ready" }))).toEqual({
      ok: false,
      code: "invalid_transition",
    });
  });

  it("refuses a cleared order even when it is preparing", () => {
    expect(canMarkReady(order({ cleared: true })).ok).toBe(false);
  });
});

describe("canRecall", () => {
  it("allows a ready order", () => {
    expect(canRecall(order({ status: "ready" })).ok).toBe(true);
  });

  it("refuses a preparing order — v1 silently succeeded here", () => {
    expect(canRecall(order())).toEqual({ ok: false, code: "invalid_transition" });
  });

  it("refuses a cleared order even when it is ready", () => {
    expect(canRecall(order({ status: "ready", cleared: true })).ok).toBe(false);
  });
});

describe("canClear", () => {
  it("allows an uncleared order in either status", () => {
    expect(canClear(order()).ok).toBe(true);
    expect(canClear(order({ status: "ready" })).ok).toBe(true);
  });

  it("refuses an already-cleared order", () => {
    expect(canClear(order({ cleared: true })).ok).toBe(false);
  });
});

describe("canUnclear", () => {
  const cleared = (overrides: Partial<Order> = {}) =>
    order({ cleared: true, clearedAt: NOW, clearedBy: "staff", ...overrides });

  it("allows an undo inside the 60 s window", () => {
    expect(canUnclear(cleared(), NOW + 59_000).ok).toBe(true);
  });

  it("allows an undo exactly on the window boundary", () => {
    expect(canUnclear(cleared(), NOW + UNDO_WINDOW_MS).ok).toBe(true);
  });

  it("refuses an undo one millisecond past the window", () => {
    expect(canUnclear(cleared(), NOW + UNDO_WINDOW_MS + 1).ok).toBe(false);
  });

  it("refuses an order that was never cleared", () => {
    expect(canUnclear(order(), NOW).ok).toBe(false);
  });

  it("refuses a purge sweep — those are never undoable one row at a time", () => {
    expect(canUnclear(cleared({ clearedBy: "purge" }), NOW).ok).toBe(false);
  });

  it("refuses a clearAll sweep for the same reason", () => {
    expect(canUnclear(cleared({ clearedBy: "clearAll" }), NOW).ok).toBe(false);
  });

  it("refuses when clearedAt never resolved", () => {
    expect(canUnclear(cleared({ clearedAt: null }), NOW).ok).toBe(false);
  });

  it("gives the server a longer window than the console offers", () => {
    // §22.2 shows the undo for 10 s; the server accepts 60 s, so the UI can never offer
    // an undo the server will refuse.
    expect(UNDO_WINDOW_MS).toBeGreaterThan(10_000);
  });
});

describe("orderNumberPattern", () => {
  it("builds the per-shop digit rule", () => {
    expect(orderNumberPattern(settings({ ticketMinDigits: 2, ticketMaxDigits: 5 })).source).toBe(
      "^\\d{2,5}$",
    );
  });
});

describe("isValidOrderNumber", () => {
  const s = settings({ ticketMinDigits: 2, ticketMaxDigits: 5 });

  it.each(["12", "123", "12345", "0042"])("accepts %s", (n) => {
    expect(isValidOrderNumber(n, s)).toBe(true);
  });

  it.each(["1", "123456", "", "12a", "a12", "1.2", "-12", " 12", "12 "])("rejects %s", (n) => {
    expect(isValidOrderNumber(n, s)).toBe(false);
  });

  it("preserves leading zeros as significant — 0042 is not 42", () => {
    const single = settings({ ticketMinDigits: 4, ticketMaxDigits: 4 });
    expect(isValidOrderNumber("0042", single)).toBe(true);
    expect(isValidOrderNumber("42", single)).toBe(false);
  });

  it("rejects a newline that would otherwise slip past a lazy $ anchor", () => {
    expect(isValidOrderNumber("12\n", s)).toBe(false);
  });
});

describe("shouldClearAll", () => {
  it("matches every uncleared order when no filter is given", () => {
    expect(shouldClearAll(order(), {}, NOW)).toBe(true);
    expect(shouldClearAll(order({ status: "ready" }), {}, NOW)).toBe(true);
  });

  it("never matches an already-cleared order", () => {
    expect(shouldClearAll(order({ cleared: true }), {}, NOW)).toBe(false);
  });

  it("filters by status", () => {
    expect(shouldClearAll(order({ status: "ready" }), { status: "ready" }, NOW)).toBe(true);
    expect(shouldClearAll(order({ status: "preparing" }), { status: "ready" }, NOW)).toBe(false);
  });

  it("measures a ready order's age from readyAt, not createdAt", () => {
    // Taken an hour ago but only ready a moment ago: the shed nudge must leave it alone.
    const justReady = order({
      status: "ready",
      createdAt: NOW - 3_600_000,
      readyAt: NOW - 10_000,
    });
    expect(shouldClearAll(justReady, { status: "ready", olderThanSeconds: 300 }, NOW)).toBe(false);
  });

  it("matches a ready order that has been waiting longer than the timeout", () => {
    const stale = order({ status: "ready", createdAt: NOW - 3_600_000, readyAt: NOW - 400_000 });
    expect(shouldClearAll(stale, { status: "ready", olderThanSeconds: 300 }, NOW)).toBe(true);
  });

  it("measures a preparing order's age from createdAt", () => {
    const old = order({ createdAt: NOW - 400_000 });
    expect(shouldClearAll(old, { status: "preparing", olderThanSeconds: 300 }, NOW)).toBe(true);
  });

  it("matches exactly on the age boundary", () => {
    const exact = order({ createdAt: NOW - 300_000 });
    expect(shouldClearAll(exact, { olderThanSeconds: 300 }, NOW)).toBe(true);
  });

  it("falls back to createdAt when a ready order has no readyAt", () => {
    const odd = order({ status: "ready", createdAt: NOW - 400_000, readyAt: null });
    expect(shouldClearAll(odd, { status: "ready", olderThanSeconds: 300 }, NOW)).toBe(true);
  });

  it("leaves an order alone when its timestamp has not resolved yet", () => {
    // An unresolved serverTimestamp cannot be proven old enough to clear.
    expect(shouldClearAll(order({ createdAt: null }), { olderThanSeconds: 1 }, NOW)).toBe(false);
  });
});

describe("purgeCutoff", () => {
  it("is six hours back", () => {
    expect(STALE_HOURS).toBe(6);
    expect(purgeCutoff(NOW)).toBe(NOW - 6 * 60 * 60 * 1000);
  });
});

describe("isStale", () => {
  it("marks an order older than six hours", () => {
    expect(isStale(order({ createdAt: NOW - 6 * 3600_000 - 1 }), NOW)).toBe(true);
  });

  it("leaves an order exactly six hours old alone", () => {
    expect(isStale(order({ createdAt: NOW - 6 * 3600_000 }), NOW)).toBe(false);
  });

  it("ignores already-cleared orders", () => {
    expect(isStale(order({ createdAt: 0, cleared: true }), NOW)).toBe(false);
  });

  it("ignores an unresolved createdAt", () => {
    expect(isStale(order({ createdAt: null }), NOW)).toBe(false);
  });

  it("sweeps preparing orders too — the display filter never clears them", () => {
    expect(isStale(order({ status: "preparing", createdAt: NOW - 7 * 3600_000 }), NOW)).toBe(true);
  });
});

describe("rateLimitDecision", () => {
  const { limit, windowMs } = RATE_LIMITS.add;

  it("opens a window for a first request", () => {
    const d = rateLimitDecision(undefined, NOW, limit, windowMs);
    expect(d.allowed).toBe(true);
    expect(d.entry).toEqual({ count: 1, windowStart: NOW });
  });

  it("counts up within the window", () => {
    const d = rateLimitDecision({ count: 3, windowStart: NOW }, NOW + 1_000, limit, windowMs);
    expect(d.allowed).toBe(true);
    expect(d.entry).toEqual({ count: 4, windowStart: NOW });
  });

  it("allows the last request at the limit", () => {
    const d = rateLimitDecision({ count: limit - 1, windowStart: NOW }, NOW + 1, limit, windowMs);
    expect(d.allowed).toBe(true);
    expect(d.entry.count).toBe(limit);
  });

  it("refuses the one after, with a retry hint", () => {
    const d = rateLimitDecision({ count: limit, windowStart: NOW }, NOW + 30_000, limit, windowMs);
    expect(d.allowed).toBe(false);
    expect(d.retryAfterSeconds).toBe(30);
  });

  it("never reports retryAfterSeconds of zero while refusing", () => {
    const d = rateLimitDecision({ count: limit, windowStart: NOW }, NOW + windowMs - 1, limit, windowMs);
    expect(d.allowed).toBe(false);
    expect(d.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("does not extend the window when it refuses", () => {
    // Otherwise a client hammering the endpoint could hold itself locked out forever.
    const entry = { count: limit, windowStart: NOW };
    const d = rateLimitDecision(entry, NOW + 30_000, limit, windowMs);
    expect(d.entry).toEqual(entry);
  });

  it("opens a fresh window once the old one has elapsed", () => {
    const d = rateLimitDecision({ count: limit, windowStart: NOW }, NOW + windowMs, limit, windowMs);
    expect(d.allowed).toBe(true);
    expect(d.entry).toEqual({ count: 1, windowStart: NOW + windowMs });
  });

  it("uses the §14.1 ceilings", () => {
    expect(RATE_LIMITS.add).toEqual({ limit: 60, windowMs: 60_000 });
    expect(RATE_LIMITS.clearAll).toEqual({ limit: 5, windowMs: 60_000 });
  });
});

describe("pruneRateLimits", () => {
  it("keeps recent entries and drops stale ones, so the document stays bounded", () => {
    const entries = {
      fresh: { count: 1, windowStart: NOW },
      edge: { count: 1, windowStart: NOW - 15 * 60 * 1000 },
      stale: { count: 1, windowStart: NOW - 15 * 60 * 1000 - 1 },
    };
    expect(Object.keys(pruneRateLimits(entries, NOW)).sort()).toEqual(["edge", "fresh"]);
  });

  it("returns a new object rather than mutating the input", () => {
    const entries = { a: { count: 1, windowStart: 0 } };
    const pruned = pruneRateLimits(entries, NOW);
    expect(pruned).not.toBe(entries);
    expect(entries.a).toBeDefined();
  });
});
