import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { admin, ensureOutsider, ensureTestUser, LOCAL, OUTSIDER, TEST_USER } from "../helpers/db";
import { isAdmin } from "@/lib/admin";

/**
 * An account in this Supabase project is not a key to CoachOS. Accounts are
 * shared with the marketing site, and sign-up was once open to anyone. Only
 * the admin role — which only the service role can grant — reaches the
 * families' data, through the app or straight through the REST API.
 */

async function as(user: { email: string; password: string }, schema: "ops" | "public" = "ops") {
  const client = createClient(LOCAL.url, LOCAL.anonKey, { db: { schema }, auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword(user);
  if (error) throw error;
  return client;
}

beforeAll(async () => {
  await ensureTestUser();
  await ensureOutsider();
  await admin.from("schools").insert({ name: "Admins-only check school" });
});

describe("who counts as admin", () => {
  it("is the role in app_metadata, nothing else", () => {
    expect(isAdmin({ app_metadata: { role: "admin" } })).toBe(true);
    expect(isAdmin({ app_metadata: {} })).toBe(false);
    expect(isAdmin({ app_metadata: { role: "Admin" } })).toBe(false);
    expect(isAdmin(null)).toBe(false);
    // user_metadata is the user's own to edit, so it must never count.
    expect(isAdmin({ app_metadata: {}, user_metadata: { role: "admin" } } as any)).toBe(false);
  });
});

describe("straight through the database's API", () => {
  it("someone signed in without the role sees no families and changes nothing", async () => {
    const outsider = await as(OUTSIDER);
    const { data: schools } = await outsider.from("schools").select("id");
    expect(schools ?? []).toEqual([]);
    const { data: parents } = await outsider.from("parents").select("id");
    expect(parents ?? []).toEqual([]);
    const { error } = await outsider.from("schools").insert({ name: "Planted by an outsider" });
    expect(error).not.toBeNull();
    // A user can write their own user_metadata; it doesn't make them admin.
    await outsider.auth.updateUser({ data: { role: "admin" } });
    const { data: still } = await outsider.from("schools").select("id");
    expect(still ?? []).toEqual([]);
  });

  it("someone signed in without the role can't change the website", async () => {
    const outsider = await as(OUTSIDER, "public");
    const { data } = await outsider.rpc("is_admin");
    expect(data).toBe(false);
  });

  it("the owner can", async () => {
    const owner = await as(TEST_USER);
    const { data } = await owner.from("schools").select("id, name").eq("name", "Admins-only check school");
    expect(data?.length).toBe(1);
    const site = await as(TEST_USER, "public");
    expect((await site.rpc("is_admin")).data).toBe(true);
  });
});
