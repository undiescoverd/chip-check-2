import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Integration suite — runs the real server modules against the Firestore emulator.
// §28 assumed the sandbox had no emulator; it does, so the transaction semantics that
// carry this phase's risk are exercised for real rather than against a stub.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Each test clears the whole emulator database, so files must not overlap.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
});
