import { describe, it, expect, vi } from "vitest";
import { readdirSync } from "node:fs";
import path from "node:path";
import { signedOut } from "../helpers/auth";
import { NOT_SIGNED_IN } from "@/lib/auth-guard";

/**
 * Every export of a "use server" module is a public endpoint: anyone holding
 * its id can call it, signed in or not, and the ids ship in the page bundles.
 * Middleware guards pages, not actions. And every action here holds the
 * service role, which no database rule restricts.
 *
 * So every action must refuse a caller who isn't signed in before it reaches
 * the database. This calls each one signed out and fails if any of them so
 * much as opens a database client. A new action without a guard fails here.
 */

// Count every database client opened.
const opened = { admin: 0 };
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...actual,
    createAdminSupabase: (...args: Parameters<typeof actual.createAdminSupabase>) => {
      opened.admin++;
      return actual.createAdminSupabase(...args);
    },
  };
});

/**
 * Meant for people who aren't signed in. Each is reached from a public page
 * and checks something else instead: a family's private token, or nothing
 * more than a registration form.
 */
const PUBLIC: Record<string, string[] | "*"> = {
  "pay-page.ts": "*", // /pay/{token}: every action checks the family's token
  "auth.ts": "*", // signing in and out
  "registrations.ts": ["submitRegistration"], // the public /join form
};

const dir = path.resolve(__dirname, "../../apps/web/src/lib/actions");
const modules = readdirSync(dir).filter((f) => f.endsWith(".ts"));

describe("every server action refuses anyone who isn't signed in", () => {
  for (const file of modules) {
    it(file, async () => {
      const mod = await import(path.join(dir, file));
      const allowed = PUBLIC[file] ?? [];
      const guarded = Object.entries(mod).filter(
        ([name, fn]) => typeof fn === "function" && allowed !== "*" && !allowed.includes(name)
      );

      for (const [name, fn] of guarded) {
        opened.admin = 0;
        let result: unknown;
        let threw: unknown;
        await signedOut(async () => {
          try {
            result = await (fn as (...a: unknown[]) => Promise<unknown>)("x", "x", new FormData());
          } catch (e) {
            threw = e;
          }
        });

        expect(opened.admin, `${file} → ${name} opened the database for a signed-out caller`).toBe(0);
        if (threw) {
          expect(String((threw as Error).message), `${file} → ${name}`).toBe(NOT_SIGNED_IN.error);
        } else {
          // A refusal, or the empty answer a read gives when there is no one to answer.
          expect([NOT_SIGNED_IN, null, 0], `${file} → ${name} returned ${JSON.stringify(result)}`).toContainEqual(
            result
          );
        }
      }
    });
  }

  it("names only public actions that exist", async () => {
    for (const [file, names] of Object.entries(PUBLIC)) {
      const mod = await import(path.join(dir, file));
      if (names !== "*") for (const n of names) expect(typeof mod[n], `${file} → ${n}`).toBe("function");
    }
  });
});
