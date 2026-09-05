import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env";

/**
 * The one behaviour worth testing in Phase 0.
 *
 * v1 accepted any write when STAFF_PIN was unset, because `undefined === undefined`.
 * These tests exist to prove that a missing secret is loud, not silent (§7.3).
 */

const valid = {
  FIREBASE_SERVICE_ACCOUNT_JSON: "eyJmYWtlIjoidmFsdWUifQ==",
  STAFF_SESSION_SECRET: "x".repeat(32),
  CRON_SECRET: "cron-secret",
};

describe("parseServerEnv", () => {
  it("accepts a complete server environment", () => {
    const env = parseServerEnv(valid);
    expect(env.CRON_SECRET).toBe("cron-secret");
    expect(env.BILLING_ENABLED).toBe(false);
  });

  it("throws when the environment is empty (fails closed)", () => {
    expect(() => parseServerEnv({})).toThrow(/Invalid server environment/);
  });

  it.each(["FIREBASE_SERVICE_ACCOUNT_JSON", "STAFF_SESSION_SECRET", "CRON_SECRET"])(
    "throws when %s is missing",
    (key) => {
      const raw = { ...valid, [key]: undefined };
      expect(() => parseServerEnv(raw)).toThrow(new RegExp(key));
    },
  );

  it("rejects a STAFF_SESSION_SECRET that is too short to sign cookies", () => {
    expect(() => parseServerEnv({ ...valid, STAFF_SESSION_SECRET: "short" })).toThrow(
      /STAFF_SESSION_SECRET/,
    );
  });

  it("does not require Stripe vars while billing is off", () => {
    expect(() => parseServerEnv({ ...valid, BILLING_ENABLED: "false" })).not.toThrow();
  });

  it("requires Stripe vars once billing is on", () => {
    expect(() => parseServerEnv({ ...valid, BILLING_ENABLED: "true" })).toThrow(
      /STRIPE_SECRET_KEY/,
    );
  });

  it("never echoes a secret value in the error message", () => {
    const secret = "super-secret-value-that-must-not-leak-abcdefgh";
    try {
      parseServerEnv({ ...valid, STAFF_SESSION_SECRET: "short", STRIPE_SECRET_KEY: secret });
    } catch (err) {
      expect(String(err)).not.toContain(secret);
      return;
    }
    throw new Error("expected parseServerEnv to throw");
  });
});
