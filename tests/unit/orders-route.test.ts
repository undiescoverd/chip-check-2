import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/orders", () => ({
  addOrder: vi.fn(),
  markReady: vi.fn(),
  recall: vi.fn(),
  clear: vi.fn(),
  unclear: vi.fn(),
  clearAll: vi.fn(),
}));

import { POST } from "@/app/api/shops/[shopId]/orders/route";
import { resetServerEnvCache } from "@/lib/env";
import { STAFF_COOKIE_NAME, signStaffCookie } from "@/lib/server/staffCookie";
import { ApiError } from "@/lib/server/errors";
import * as orders from "@/lib/server/orders";
import type { Order } from "@/lib/types";

/**
 * Route contract (§13, §14): auth, body validation, action dispatch and error mapping.
 *
 * The service layer is mocked here on purpose — the real Firestore behaviour (the dedupe
 * race, lock re-acquisition, batching) is proven against the emulator in
 * `tests/integration/orders.test.ts`, which is a better test than any hand-rolled stub of
 * Firestore's transaction semantics would be.
 */

const SECRET = "s".repeat(48);
const SHOP = "shop1";

const sampleOrder: Order = {
  id: "order1",
  orderNumber: "0042",
  status: "preparing",
  createdAt: 1_700_000_000_000,
  readyAt: null,
  cleared: false,
  clearedAt: null,
  clearedBy: null,
};

function post(body: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${STAFF_COOKIE_NAME}=${signStaffCookie(SHOP)}`,
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
  const req = new Request(`https://example.test/api/shops/${SHOP}/orders`, init);
  return POST(req, { params: { shopId: SHOP } });
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", "e30=");
  vi.stubEnv("STAFF_SESSION_SECRET", SECRET);
  vi.stubEnv("CRON_SECRET", "c".repeat(32));
  resetServerEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  resetServerEnvCache();
});

describe("POST /api/shops/{shopId}/orders — auth", () => {
  it("refuses a request with no staff credential", async () => {
    const res = await post({ action: "add", orderNumber: "42" }, { cookie: "" });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("checks auth before parsing the body, so an unauthenticated caller learns nothing", async () => {
    const res = await post("not json at all", { cookie: "" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/shops/{shopId}/orders — body validation", () => {
  it("returns invalid_json for a malformed body", async () => {
    const res = await post("{ not json");
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid_json" });
  });

  it("returns invalid_body with issues for a schema failure", async () => {
    const res = await post({ action: "markReady" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_body");
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it("rejects an unknown action", async () => {
    const res = await post({ action: "purgeStale" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/shops/{shopId}/orders — dispatch", () => {
  it("adds, passing the first forwarded hop as the rate-limit key", async () => {
    vi.mocked(orders.addOrder).mockResolvedValue(sampleOrder);
    const res = await post({ action: "add", orderNumber: "0042" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ order: sampleOrder });
    expect(orders.addOrder).toHaveBeenCalledWith(SHOP, "0042", "203.0.113.7");
  });

  it.each([
    ["markReady", "markReady"],
    ["recall", "recall"],
    ["clear", "clear"],
    ["unclear", "unclear"],
  ] as const)("routes %s to the matching service call", async (action, fn) => {
    vi.mocked(orders[fn]).mockResolvedValue(sampleOrder);
    const res = await post({ action, id: "order1" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ order: sampleOrder });
    expect(orders[fn]).toHaveBeenCalledWith(SHOP, "order1");
  });

  it("returns a count for clearAll, not an order", async () => {
    vi.mocked(orders.clearAll).mockResolvedValue(3);
    const res = await post({ action: "clearAll" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ cleared: 3 });
  });

  it("passes the shed-nudge filters through", async () => {
    vi.mocked(orders.clearAll).mockResolvedValue(0);
    await post({ action: "clearAll", status: "ready", olderThanSeconds: 300 });

    expect(orders.clearAll).toHaveBeenCalledWith(
      SHOP,
      { status: "ready", olderThanSeconds: 300 },
      "203.0.113.7",
    );
  });

  it("falls back to x-real-ip when there is no forwarded header", async () => {
    vi.mocked(orders.addOrder).mockResolvedValue(sampleOrder);
    await post(
      { action: "add", orderNumber: "1" },
      { "x-forwarded-for": "", "x-real-ip": "198.51.100.4" },
    );
    expect(orders.addOrder).toHaveBeenCalledWith(SHOP, "1", "198.51.100.4");
  });
});

describe("POST /api/shops/{shopId}/orders — error mapping", () => {
  it("passes a duplicate_order through with the active order attached", async () => {
    vi.mocked(orders.addOrder).mockRejectedValue(
      new ApiError(409, "duplicate_order", { order: sampleOrder }),
    );
    const res = await post({ action: "add", orderNumber: "0042" });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: "duplicate_order", order: sampleOrder });
  });

  it("passes invalid_transition through with the order's state", async () => {
    vi.mocked(orders.markReady).mockRejectedValue(
      new ApiError(409, "invalid_transition", { status: "ready", cleared: false }),
    );
    const res = await post({ action: "markReady", id: "order1" });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "invalid_transition",
      status: "ready",
      cleared: false,
    });
  });

  it("passes rate_limited through with a retry hint", async () => {
    vi.mocked(orders.addOrder).mockRejectedValue(
      new ApiError(429, "rate_limited", { retryAfterSeconds: 30 }),
    );
    const res = await post({ action: "add", orderNumber: "1" });

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: "rate_limited", retryAfterSeconds: 30 });
  });

  it("returns 404 order_not_found for an unknown id", async () => {
    vi.mocked(orders.clear).mockRejectedValue(new ApiError(404, "order_not_found"));
    const res = await post({ action: "clear", id: "gone" });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "order_not_found" });
  });

  it("returns 402 subscription_required when unentitled", async () => {
    vi.mocked(orders.addOrder).mockRejectedValue(
      new ApiError(402, "subscription_required", { status: "canceled" }),
    );
    const res = await post({ action: "add", orderNumber: "1" });
    expect(res.status).toBe(402);
  });

  it("turns an unexpected error into a 500 that leaks nothing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(orders.addOrder).mockRejectedValue(
      new Error("FIRESTORE INTERNAL: projects/chipcheck-dev/databases/(default) unavailable"),
    );

    const res = await post({ action: "add", orderNumber: "1" });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("internal");
    expect(typeof body.requestId).toBe("string");
    // v1 returned HTML error pages carrying stack traces.
    expect(JSON.stringify(body)).not.toContain("FIRESTORE");
    expect(JSON.stringify(body)).not.toContain("chipcheck-dev");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
