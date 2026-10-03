import { describe, it, expect, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, ensureOutsider, ensureTestUser, LOCAL } from "../helpers/db";
import { vi } from "vitest";
import { inviteToCoachOS, removeAccess, listAccess, requestPasswordLink } from "@/lib/actions/access";

// Catch what would be emailed.
const staffEmails: { to: string; subject: string }[] = [];
vi.mock("@/lib/staff-email", () => ({
  sendStaffEmail: async (_db: unknown, opts: { to: string; subject: string }) => {
    staffEmails.push({ to: opts.to, subject: opts.subject });
    return true;
  },
}));

/**
 * Who can sign in is managed from Settings. An invite makes an admin who
 * chooses their own password from a one-time link; access can be taken away,
 * but never your own and never the last person's.
 */

const authAdmin = createClient(LOCAL.url, LOCAL.serviceKey, { auth: { persistSession: false } });
const NEW = "new.coach@example.test";

async function find(email: string) {
  const { data } = await authAdmin.auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === email);
}

afterAll(async () => {
  const u = await find(NEW);
  if (u) await authAdmin.auth.admin.deleteUser(u.id);
});

describe("inviting", () => {
  it("makes an admin with a one-time link that lets them choose a password", async () => {
    await ensureTestUser();
    const res: any = await inviteToCoachOS(NEW, "Sam");
    expect(res.error).toBeUndefined();
    expect(res.link).toMatch(/\/welcome\?token_hash=[^&]+&type=invite$/);
    const user = await find(NEW);
    expect(user?.app_metadata.role).toBe("admin");
    expect((await listAccess())!.map((p) => p.email)).toContain(NEW);

    // Following the link signs them in; then they set a password.
    const browser = createClient(LOCAL.url, LOCAL.anonKey, { auth: { persistSession: false } });
    const token_hash = decodeURIComponent(res.link.match(/token_hash=([^&]+)/)[1]);
    const { data, error } = await browser.auth.verifyOtp({ token_hash, type: "invite" });
    expect(error).toBeNull();
    expect(data.user?.email).toBe(NEW);
    // The link works once.
    expect((await browser.auth.verifyOtp({ token_hash, type: "invite" })).error).not.toBeNull();
  });

  it("refuses something that isn't an email", async () => {
    expect(((await inviteToCoachOS("not-an-email")) as any).error).toMatch(/email/);
  });
});

describe("taking access away", () => {
  it("removes the role, but never your own and never the last person's", async () => {
    // Who tests/setup.ts signs in as.
    const me = "00000000-0000-0000-0000-00000000b055";
    expect(((await removeAccess(me)) as any).error).toMatch(/your own/);
    const user = await find(NEW);
    // Signed in, with access, before it's taken away.
    await authAdmin.auth.admin.updateUserById(user!.id, { password: "new-coach-password-1" });
    const theirs = createClient(LOCAL.url, LOCAL.anonKey, { db: { schema: "ops" }, auth: { persistSession: false } });
    await theirs.auth.signInWithPassword({ email: NEW, password: "new-coach-password-1" });
    await admin.from("schools").insert({ name: "Access check school" });
    expect((await theirs.from("schools").select("id")).data?.length).toBeGreaterThan(0);

    expect(((await removeAccess(user!.id)) as any).success).toBe(true);
    expect((await find(NEW))?.app_metadata.role ?? null).toBeNull();
    // The session they already hold stops working at once — not when its token expires.
    expect((await theirs.from("schools").select("id")).data ?? []).toEqual([]);
    await admin.from("schools").delete().eq("name", "Access check school");
  });
});

describe("forgot your password", () => {
  it("answers the same for anyone, and only emails people with access", async () => {
    staffEmails.length = 0;
    await ensureTestUser();
    await ensureOutsider();
    expect(await requestPasswordLink("nobody@example.test")).toEqual({ success: true });
    expect(await requestPasswordLink("outsider@example.test")).toEqual({ success: true });
    expect(await requestPasswordLink("TEST-OWNER@example.test")).toEqual({ success: true });
    expect(((await requestPasswordLink("nope")) as any).error).toBeTruthy();
    // Only the person with access got a link.
    expect(staffEmails).toEqual([{ to: "test-owner@example.test", subject: "Your CoachOS password link" }]);
  });
});
