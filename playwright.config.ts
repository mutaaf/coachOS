import { defineConfig, devices } from "@playwright/test";
import { execSync } from "node:child_process";

const PORT = 3051;

/**
 * Point the app under test at the local Supabase stack.
 *
 * Read from `supabase status` rather than from a checked-in .env, so an e2e run
 * can never be pointed at the hosted project by a stale environment variable.
 */
function localSupabase() {
  const status = JSON.parse(
    execSync("supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  );
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(status.API_URL)) {
    throw new Error(`Refusing to run e2e against a non-local database: ${status.API_URL}`);
  }
  return status;
}

const supabase = localSupabase();

export default defineConfig({
  testDir: "./tests/e2e",
  // The registration flow depends on seat counts, and parallel workers would
  // race each other for the same seats.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    cwd: "apps/web",
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabase.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: supabase.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: supabase.SERVICE_ROLE_KEY,
      CRON_SECRET: "test-cron-secret",
    },
  },
});
