import { execSync } from "node:child_process";
import { afterEach, vi } from "vitest";

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

// Actions check who is signed in. Tests run as the signed-in owner unless they
// wrap a call in signedOut() (tests/helpers/auth.ts), which is how each
// action's refusal is checked.
vi.mock("@/lib/auth-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth-guard")>();
  const user = async () =>
    (globalThis as any).__signedOut ? null : { id: "00000000-0000-0000-0000-00000000b055", email: "boss@example.test" };
  return {
    ...actual,
    currentUser: user,
    signedIn: async () => !!(await user()),
    requireSignedIn: async () => {
      if (!(await user())) throw new Error(actual.NOT_SIGNED_IN.error);
    },
  };
});

afterEach(() => {
  (globalThis as any).__signedOut = false;
});
