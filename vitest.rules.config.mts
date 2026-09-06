import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Rules suite — CI only, runs inside `firebase emulators:exec` (§28).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rules/**/*.test.ts"],
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
});
