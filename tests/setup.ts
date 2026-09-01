import { execSync } from "node:child_process";
import { vi } from "vitest";

// Point the app's server actions at the local stack before they are imported.
const status = JSON.parse(
  execSync("supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
);

if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(status.API_URL)) {
  throw new Error(`Refusing to run tests against a non-local database: ${status.API_URL}`);
}

process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = status.ANON_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;

// The actions call these Next APIs, which only exist inside a request.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));
