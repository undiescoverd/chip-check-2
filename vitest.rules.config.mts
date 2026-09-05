import { defineConfig } from "vitest/config";

// Rules suite — CI only, runs inside `firebase emulators:exec` (§28).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rules/**/*.test.ts"],
    testTimeout: 20_000,
    // Phase 1 adds the real suite (§10); until then an empty run must not fail CI.
    passWithNoTests: true,
  },
});
