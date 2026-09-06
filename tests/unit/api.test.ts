import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NETWORK_ERROR,
  duplicateOrder,
  orderErrorCopy,
  postOrderAction,
  unlockErrorCopy,
  unlockStaff,
} from "@/lib/api";

/**
 * §23's code → copy map, and the client half of §14's error contract.
 *
 * The assertions worth having are the action-sensitive ones. Two codes mean different
 * things depending on what the client sent, and getting them the wrong way round is
 * invisible until a member of staff is told "That order changed — refresh" when what
 * actually happened is that their undo was a minute too late.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("orderErrorCopy", () => {
  it("names the shop's own digit rule", () => {
    expect(orderErrorCopy("invalid_order_number", "add", { min: 2, max: 5 })).toBe(
      "Enter 2–5 digits",
    );
  });

  it("says 'digits' once when the range is exact", () => {
    expect(orderErrorCopy("invalid_order_number", "add", { min: 4, max: 4 })).toBe(
      "Enter 4 digits",
    );
  });

  it("falls back when the server sent no range", () => {
    expect(orderErrorCopy("invalid_order_number", "add", {})).toBe("Failed to add order");
  });

  it("treats duplicate_order from an undo as a refused undo", () => {
    const details = { order: { id: "o2", orderNumber: "0042", status: "preparing" } };
    expect(orderErrorCopy("duplicate_order", "unclear", details)).toBe(
      "Couldn't undo — #0042 is active again",
    );
  });

  it("treats duplicate_order from an add as the duplicate modal's copy", () => {
    const details = { order: { id: "o2", orderNumber: "0042", status: "ready" } };
    expect(orderErrorCopy("duplicate_order", "add", details)).toBe(
      "Order #0042 is already active (ready). Clear it first, or use a different number.",
    );
  });

  it("distinguishes a closed undo window from a changed order", () => {
    // Same code, two situations: §13 returns invalid_transition both for a state guard
    // and for an undo past the server's 60 s window.
    expect(orderErrorCopy("invalid_transition", "unclear", {})).toBe("Too late to undo");
    expect(orderErrorCopy("invalid_transition", "markReady", {})).toBe(
      "That order changed — refresh",
    );
  });

  it("maps the remaining codes to their §23 strings", () => {
    expect(orderErrorCopy("order_not_found", "clear", {})).toBe("That order was already cleared");
    expect(orderErrorCopy("rate_limited", "clearAll", {})).toBe("Slow down a moment");
    expect(orderErrorCopy("invalid_body", "add", {})).toBe("Something went wrong");
    expect(orderErrorCopy("invalid_json", "add", {})).toBe("Something went wrong");
    expect(orderErrorCopy(NETWORK_ERROR, "recall", {})).toBe("Couldn't reach the server");
  });

  it("falls back per action for anything unmapped", () => {
    expect(orderErrorCopy("internal", "markReady", {})).toBe("Failed to mark order ready");
    expect(orderErrorCopy("internal", "recall", {})).toBe("Failed to recall order");
    expect(orderErrorCopy("internal", "clear", {})).toBe("Failed to clear order");
    expect(orderErrorCopy("internal", "clearAll", {})).toBe("Failed to clear all orders");
  });
});

describe("unlockErrorCopy", () => {
  it("says which PIN problem it was", () => {
    expect(unlockErrorCopy("invalid_pin")).toBe("Wrong PIN");
  });

  it("rounds the lockout up to whole minutes", () => {
    // 61 s left is "2 min" — rounding down would invite a tap that is refused again.
    expect(unlockErrorCopy("pin_locked", { retryAfterSeconds: 61 })).toBe(
      "Too many attempts — try again in 2 min",
    );
    expect(unlockErrorCopy("pin_locked", { retryAfterSeconds: 900 })).toBe(
      "Too many attempts — try again in 15 min",
    );
  });

  it("never says zero minutes", () => {
    expect(unlockErrorCopy("pin_locked", { retryAfterSeconds: 1 })).toBe(
      "Too many attempts — try again in 1 min",
    );
  });

  it("maps the codes §23 gives the gate no copy for", () => {
    expect(unlockErrorCopy("shop_not_found")).toBe("Something went wrong");
    expect(unlockErrorCopy(NETWORK_ERROR)).toBe("Couldn't reach the server");
  });
});

describe("duplicateOrder", () => {
  it("returns the active order the server sent back", () => {
    const order = { id: "o2", orderNumber: "0042", status: "ready" };
    const found = duplicateOrder({ code: "duplicate_order", status: 409, details: { order }, message: "" });
    expect(found?.orderNumber).toBe("0042");
  });

  it("returns null when the body carried no usable order", () => {
    expect(
      duplicateOrder({ code: "duplicate_order", status: 409, details: {}, message: "" }),
    ).toBeNull();
  });
});

describe("postOrderAction", () => {
  it("returns the parsed body on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ order: { id: "o1" } }), { status: 200 })),
    );

    const result = await postOrderAction("shop1", { action: "add", orderNumber: "42" });
    expect(result).toEqual({ ok: true, data: { order: { id: "o1" } } });
  });

  it("carries the code, the status, the details and the mapped copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "invalid_order_number", min: 2, max: 5 }), {
            status: 400,
          }),
      ),
    );

    const result = await postOrderAction("shop1", { action: "add", orderNumber: "1" });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_order_number",
        status: 400,
        details: { min: 2, max: 5 },
        message: "Enter 2–5 digits",
      },
    });
  });

  it("turns a failed fetch into the network copy rather than throwing", async () => {
    // A tablet that has just lost the counter's wifi. The console must show a state,
    // not an unhandled rejection (§14).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const result = await postOrderAction("shop1", { action: "clear", id: "o1" });
    expect(result).toEqual({
      ok: false,
      error: { code: NETWORK_ERROR, status: 0, details: {}, message: "Couldn't reach the server" },
    });
  });

  it("survives an error response that is not JSON", async () => {
    // A proxy 502 or a Vercel error page: still a mapped message, still no throw.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>502</html>", { status: 502 })));

    const result = await postOrderAction("shop1", { action: "markReady", id: "o1" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("internal");
      expect(result.error.message).toBe("Failed to mark order ready");
    }
  });

  it("posts the action to this shop's orders route", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await postOrderAction("shop 1", { action: "clearAll" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/shops/shop%201/orders",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "clearAll" }) }),
    );
  });
});

describe("unlockStaff", () => {
  it("posts the PIN to the shop's unlock route by slug", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await unlockStaff("test-shop", "4321");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/shops/test-shop/staff/unlock",
      expect.objectContaining({ body: JSON.stringify({ pin: "4321" }) }),
    );
  });

  it("maps a lockout to the gate's copy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "pin_locked", retryAfterSeconds: 300 }), {
            status: 429,
          }),
      ),
    );

    const result = await unlockStaff("test-shop", "0000");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe("Too many attempts — try again in 5 min");
  });
});
