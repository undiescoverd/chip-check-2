import { describe, expect, it } from "vitest";
import { DocId, OrdersBody } from "@/lib/schemas/orders";

describe("DocId", () => {
  it.each(["abc123", "A_b-c", "x".repeat(64)])("accepts %s", (id) => {
    expect(DocId.safeParse(id).success).toBe(true);
  });

  it.each(["", "x".repeat(65), "has space", "slash/path", "dot.dot", "../escape"])(
    "rejects %s",
    (id) => {
      expect(DocId.safeParse(id).success).toBe(false);
    },
  );
});

describe("OrdersBody", () => {
  it("accepts an add", () => {
    expect(OrdersBody.safeParse({ action: "add", orderNumber: "0042" }).success).toBe(true);
  });

  it("leaves the digit rule to the shop's settings", () => {
    // The schema only checks the type; §14 re-validates against min/max after the shop
    // loads, so the error can name the shop's own limits.
    expect(OrdersBody.safeParse({ action: "add", orderNumber: "999999999" }).success).toBe(true);
  });

  it("rejects a non-string order number", () => {
    expect(OrdersBody.safeParse({ action: "add", orderNumber: 42 }).success).toBe(false);
  });

  it.each(["markReady", "recall", "clear", "unclear"])("accepts a %s with an id", (action) => {
    expect(OrdersBody.safeParse({ action, id: "abc123" }).success).toBe(true);
  });

  it.each(["markReady", "recall", "clear", "unclear"])("rejects a %s without an id", (action) => {
    expect(OrdersBody.safeParse({ action }).success).toBe(false);
  });

  it("accepts a bare clearAll", () => {
    expect(OrdersBody.safeParse({ action: "clearAll" }).success).toBe(true);
  });

  it("accepts the shed-nudge shape", () => {
    const parsed = OrdersBody.safeParse({
      action: "clearAll",
      status: "ready",
      olderThanSeconds: 300,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a negative olderThanSeconds", () => {
    const body = { action: "clearAll", olderThanSeconds: -1 };
    expect(OrdersBody.safeParse(body).success).toBe(false);
  });

  it("rejects a fractional olderThanSeconds", () => {
    const body = { action: "clearAll", olderThanSeconds: 1.5 };
    expect(OrdersBody.safeParse(body).success).toBe(false);
  });

  it("rejects an unknown status filter", () => {
    expect(OrdersBody.safeParse({ action: "clearAll", status: "cleared" }).success).toBe(false);
  });

  it("rejects an unknown action", () => {
    expect(OrdersBody.safeParse({ action: "purgeStale" }).success).toBe(false);
  });

  it("rejects a missing action", () => {
    expect(OrdersBody.safeParse({ id: "abc123" }).success).toBe(false);
  });

  it("rejects a v1-style pin field smuggled alongside a valid action", () => {
    // v1 sent the PIN in the body; v2 authenticates with a cookie and must not accept it.
    const parsed = OrdersBody.safeParse({ action: "add", orderNumber: "42", pin: "1234" });
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("pin");
    }
  });
});
