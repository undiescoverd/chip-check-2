import { defineConfig, devices } from "@playwright/test";
import { E2E_PORT, baseURL, isLocal, localServerEnv } from "./tests/e2e/env";

/**
 * The Phase 3 smoke (§28, Part H task 5).
 *
 * Local mode starts `next dev` — not `next start`. `next start` forces
 * `NODE_ENV=production`, and the emulator fence in `adminApp()` refuses to run there by
 * design (PROGRESS.md deviations 10 and 28). The same fence is why the browser-side
 * emulator branch is compiled out of a production build.
 *
 * The suite is written to run unchanged against the `dev` alias: set `E2E_BASE_URL` and
 * nothing is started or seeded locally. A handful of tests need to write Firestore
 * directly (backdating an order to prove the age escalation and the shed nudge without
 * waiting eight minutes) and skip themselves in that mode.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // The board is shared state: two specs adding orders to one shop at once would fight
  // over "{n} in queue".
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Undefined in CI, where `playwright install` puts the matching build where
    // Playwright expects it. The cloud sandbox ships a Chromium of its own at a different
    // revision, and this is how a run here uses it rather than downloading a second one.
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: isLocal
    ? {
        command: `npx next dev --port ${E2E_PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: localServerEnv,
      }
    : undefined,
});
