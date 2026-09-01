import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // Lets the integration tests import the app's real server actions rather
      // than reimplementing their logic, which is the only way a test can catch
      // a bug in them.
      "@": path.resolve(__dirname, "apps/web/src"),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // These talk to a real Postgres over HTTP, and several deliberately race
    // dozens of concurrent registrations. Running files sequentially keeps the
    // shared database from being cleared out underneath a test in flight.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ["default"],
  },
});
