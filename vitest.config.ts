import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    // These talk to a real Postgres over HTTP, and several deliberately race
    // dozens of concurrent registrations. Running files sequentially keeps the
    // shared database from being cleared out underneath a test in flight.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ["default"],
  },
});
