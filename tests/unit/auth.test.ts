import { afterEach, describe, expect, it, vi } from "vitest";
import { resetServerEnvCache } from "@/lib/env";
import { requireCron, requireStaff } from "@/lib/server/auth";
import { ApiError } from "@/lib/server/errors";

const SECRET = "s".repeat(48);
const CRON = "c".repeat(32);

function env(nodeEnv: string) {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", "e30=");
  vi.stubEnv("STAFF_SESSION_SECRET", SECRET);
  vi.stubEnv("CRON_SECRET", CRON);
  resetServerEnvCache();
}

function req(headers: Record<string, string> = {}) {
  return new Request("https://example.test/api/shops/shop1/orders", { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
});

describe("requireStaff (Phase 1 dev header)", () => {
  it("accepts the dev token outside production", () => {
    env("development");
    expect(() => requireStaff(req({ "x-dev-staff-token": SECRET }), "shop1")).not.toThrow();
  });

  it("is inert in production even with the correct token", () => {
    // This is the guard that keeps a deliberately temporary hole from reaching a real
    // deployment. Asserted here rather than left to a reading of the code.
    env("production");
    expect(() => requireStaff(req({ "x-dev-staff-token": SECRET }), "shop1")).toThrow(ApiError);
    try {
      requireStaff(req({ "x-dev-staff-token": SECRET }), "shop1");
    } catch (err) {
      expect((err as ApiError).status).toBe(401);
      expect((err as ApiError).code).toBe("unauthorized");
    }
  });

  it("refuses a missing header", () => {
    env("development");
    expect(() => requireStaff(req(), "shop1")).toThrow(ApiError);
  });

  it("refuses a wrong token", () => {
    env("development");
    expect(() => requireStaff(req({ "x-dev-staff-token": "wrong" }), "shop1")).toThrow(ApiError);
  });

  it("refuses a token that is a prefix of the secret", () => {
    env("development");
    const prefix = SECRET.slice(0, 10);
    expect(() => requireStaff(req({ "x-dev-staff-token": prefix }), "shop1")).toThrow(ApiError);
  });

  it("fails closed when STAFF_SESSION_SECRET is missing entirely", () => {
    // v1's headline defect was an auth check that passed when its env var was unset.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_JSON", "e30=");
    vi.stubEnv("STAFF_SESSION_SECRET", "");
    vi.stubEnv("CRON_SECRET", CRON);
    resetServerEnvCache();
    expect(() => requireStaff(req({ "x-dev-staff-token": "" }), "shop1")).toThrow();
  });
});

describe("requireCron", () => {
  it("accepts the bearer token", () => {
    env("production");
    expect(() => requireCron(req({ authorization: `Bearer ${CRON}` }))).not.toThrow();
  });

  it("refuses a missing header", () => {
    env("production");
    expect(() => requireCron(req())).toThrow(ApiError);
  });

  it("refuses a wrong secret", () => {
    env("production");
    expect(() => requireCron(req({ authorization: "Bearer nope" }))).toThrow(ApiError);
  });

  it("refuses the bare secret without the Bearer prefix", () => {
    env("production");
    expect(() => requireCron(req({ authorization: CRON }))).toThrow(ApiError);
  });

  it("reports 401, not 403 — the caller is unauthenticated, not forbidden", () => {
    env("production");
    try {
      requireCron(req());
    } catch (err) {
      expect((err as ApiError).status).toBe(401);
    }
  });
});
