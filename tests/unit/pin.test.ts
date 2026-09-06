import { describe, expect, it } from "vitest";
import { hashPin, isValidPin, verifyPin } from "@/lib/server/pin";

/**
 * PIN hashing (§7.2 step 4). These are the assertions that stand between v2 and v1's
 * headline defect — a PIN check that passed when it should not have.
 */

describe("isValidPin", () => {
  it.each(["1234", "12345", "123456", "1234567", "12345678"])("accepts %s", (pin) => {
    expect(isValidPin(pin)).toBe(true);
  });

  it.each([
    ["123", "too short"],
    ["123456789", "too long"],
    ["", "empty"],
    ["12a4", "not all digits"],
    ["12 4", "space"],
    ["1234\n", "trailing newline — anchors must not be multiline"],
    ["-123", "sign"],
  ])("rejects %s (%s)", (pin) => {
    expect(isValidPin(pin)).toBe(false);
  });
});

describe("hashPin", () => {
  it("produces §9's stored format", async () => {
    const stored = await hashPin("1234");
    const parts = stored.split("$");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("scrypt");
    expect(parts[1]).toBe("32768"); // N = 2^15 per §7.2
    expect(Buffer.from(parts[3], "base64")).toHaveLength(64);
  });

  it("never contains the PIN", async () => {
    const stored = await hashPin("864213");
    expect(stored).not.toContain("864213");
  });

  it("salts, so the same PIN hashes differently every time", async () => {
    const [a, b] = await Promise.all([hashPin("1234"), hashPin("1234")]);
    expect(a).not.toBe(b);
    // …and both still verify.
    expect(await verifyPin("1234", a)).toBe(true);
    expect(await verifyPin("1234", b)).toBe(true);
  });
});

describe("verifyPin", () => {
  it("accepts the right PIN and refuses the wrong one", async () => {
    const stored = await hashPin("4821");
    expect(await verifyPin("4821", stored)).toBe(true);
    expect(await verifyPin("4822", stored)).toBe(false);
    expect(await verifyPin("", stored)).toBe(false);
    expect(await verifyPin("48210", stored)).toBe(false);
  });

  it("does not treat a PIN prefix as a match", async () => {
    const stored = await hashPin("12345678");
    expect(await verifyPin("1234", stored)).toBe(false);
  });

  /**
   * Every malformed-hash case must read as "wrong PIN", never as "no PIN set".
   * Failing open on a corrupted record is exactly the v1 defect.
   */
  it.each([
    ["", "empty"],
    ["not-a-hash", "no delimiters"],
    ["scrypt$32768$onlythree", "too few parts"],
    ["bcrypt$32768$c2FsdA==$aGFzaA==", "unknown algorithm"],
    ["scrypt$notanumber$c2FsdA==$aGFzaA==", "non-numeric cost"],
    ["scrypt$32768$$aGFzaA==", "empty salt"],
    ["scrypt$32768$c2FsdA==$", "empty hash"],
    ["scrypt$32768$c2FsdA==$c2hvcnQ=", "hash of the wrong length"],
    ["scrypt$1073741824$c2FsdA==$aGFzaA==", "absurd cost factor — a DoS on ourselves"],
    ["scrypt$32769$c2FsdA==$aGFzaA==", "cost factor that is not a power of two"],
    ["scrypt$512$c2FsdA==$aGFzaA==", "cost factor below the floor"],
  ])("refuses a malformed hash: %s (%s)", async (stored) => {
    expect(await verifyPin("1234", stored)).toBe(false);
  });

  it("verifies a hash written at a lower cost factor than the current one", async () => {
    // The parameters live in the stored string so N can be raised later without
    // invalidating existing hashes. Build one at N=2^14 by hand to prove it.
    const { scrypt } = await import("node:crypto");
    const { promisify } = await import("node:util");
    const s = promisify(scrypt) as (
      p: string,
      salt: Buffer,
      len: number,
      opts: Record<string, number>,
    ) => Promise<Buffer>;

    const salt = Buffer.from("0123456789abcdef");
    const hash = await s("1234", salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const stored = `scrypt$16384$${salt.toString("base64")}$${hash.toString("base64")}`;

    expect(await verifyPin("1234", stored)).toBe(true);
    expect(await verifyPin("9999", stored)).toBe(false);
  });
});
