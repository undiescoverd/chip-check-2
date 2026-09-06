/**
 * Where the end-to-end suite is pointed, and the throwaway configuration that lets it run
 * against a local server on the emulator (§28).
 *
 * Two modes, and the difference is one variable:
 *
 *  - **local** (no `E2E_BASE_URL`): Playwright starts `next dev` itself, both Firebase
 *    SDKs are pointed at the emulator, and the shop is seeded before the run. Everything
 *    here is a throwaway value; nothing is a secret.
 *  - **remote** (`E2E_BASE_URL` set): the suite drives a deployed Preview, seeds nothing
 *    and starts nothing. That is the mode the Phase 3 Definition of Done asks for once
 *    the `dev` alias exists; the tests are identical either way.
 */

export const E2E_PORT = 3100;
export const LOCAL_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

/** The suite drives a deployed Preview when this is set, and a local server when not. */
export const remoteBaseUrl = process.env.E2E_BASE_URL?.replace(/\/$/, "");
export const isLocal = !remoteBaseUrl;
export const baseURL = remoteBaseUrl ?? LOCAL_BASE_URL;

export const SHOP_SLUG = process.env.E2E_SHOP_SLUG ?? "test-shop";
/** Local mode seeds this PIN itself, so the default is not a secret anywhere. */
export const STAFF_PIN = process.env.E2E_STAFF_PIN ?? "4321";

/** Phase 3's Definition of Done sets the test shop to 2–5 digits. */
export const MIN_DIGITS = 2;
export const MAX_DIGITS = 5;

export const FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
export const EMULATOR_PROJECT_ID = process.env.FIREBASE_EMULATOR_PROJECT_ID ?? "demo-chipcheck";

/**
 * The environment `next dev` runs under in local mode. The Firebase values point both
 * SDKs at the emulator; the secrets are throwaway strings that only have to satisfy
 * `lib/env.ts` (§7.3 requires them to exist, and the suite proves nothing by using real
 * ones).
 */
export const localServerEnv: Record<string, string> = {
  FIRESTORE_EMULATOR_HOST,
  FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099",
  FIREBASE_EMULATOR_PROJECT_ID: EMULATOR_PROJECT_ID,
  FIREBASE_SERVICE_ACCOUNT_JSON: "e30=",
  STAFF_SESSION_SECRET: "e".repeat(48),
  CRON_SECRET: "c".repeat(32),
  BILLING_ENABLED: "false",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: EMULATOR_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_API_KEY: "emulator-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "localhost",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:0:web:emulator",
  // The browser's Firestore client takes its emulator branch from this (see
  // `lib/firebase/client.ts`). It is never set in Preview or Production.
  NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: FIRESTORE_EMULATOR_HOST,
};
