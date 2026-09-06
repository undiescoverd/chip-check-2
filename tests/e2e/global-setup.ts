import { execFileSync } from "node:child_process";
import {
  EMULATOR_PROJECT_ID,
  FIRESTORE_EMULATOR_HOST,
  MAX_DIGITS,
  MIN_DIGITS,
  SHOP_SLUG,
  STAFF_PIN,
  isLocal,
} from "./env";

/**
 * Seed the shop the suite drives (local mode only).
 *
 * `--reset` clears the previous run's orders, so a failed run cannot leave rows that make
 * the next one's "1 in queue" assertions wrong. Against a Preview this does nothing: the
 * sandbox has no service account, and a suite that silently rewrites a real shop's PIN
 * would be a worse failure than a red test.
 */
export default function globalSetup() {
  if (!isLocal) {
    console.log(`E2E: driving ${process.env.E2E_BASE_URL} — not seeding.`);
    return;
  }

  execFileSync(
    "node",
    [
      "scripts/seed-shop.mjs",
      `--slug=${SHOP_SLUG}`,
      `--pin=${STAFF_PIN}`,
      `--min=${MIN_DIGITS}`,
      `--max=${MAX_DIGITS}`,
      "--reset",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        FIRESTORE_EMULATOR_HOST,
        FIREBASE_EMULATOR_PROJECT_ID: EMULATOR_PROJECT_ID,
      },
    },
  );
}
