import { describe, expect, it } from "vitest";
import { pressKey } from "@/lib/orders/keypad";

/**
 * §22.2's keypad rules. The cap is the one that matters: it is per shop
 * (`ticketMaxDigits`, 1–6), and v1 hardcoded four digits everywhere. A shop on pager
 * numbers 1–3 must not be able to type a fourth digit that the server will then reject.
 */

describe("pressKey", () => {
  it("appends a digit", () => {
    expect(pressKey("12", "3", 4)).toBe("123");
  });

  it("stops at the shop's maximum instead of silently truncating later", () => {
    expect(pressKey("1234", "5", 4)).toBe("1234");
    expect(pressKey("12345", "6", 5)).toBe("12345");
  });

  it("keeps a leading zero", () => {
    // Order numbers are strings, digits only, leading zeros preserved (§9).
    expect(pressKey("", "0", 4)).toBe("0");
    expect(pressKey("0", "7", 4)).toBe("07");
  });

  it("backspaces one digit and is harmless when empty", () => {
    expect(pressKey("123", "back", 4)).toBe("12");
    expect(pressKey("", "back", 4)).toBe("");
  });

  it("clears the whole field", () => {
    expect(pressKey("1234", "clear", 4)).toBe("");
  });
});
