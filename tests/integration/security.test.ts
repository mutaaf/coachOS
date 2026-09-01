import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  admin,
  adminPublic,
  anonOps,
  anonPublic,
  register,
  seedProgram,
  truncateAll,
} from "../helpers/db";

/**
 * These are the tests that matter most.
 *
 * The anon key is embedded in the marketing site's JavaScript bundle, so it is
 * effectively public. Everything asserted here is what stops a stranger with
 * that key from reading children's names and medical notes, or rewriting the
 * site's content.
 */

afterEach(truncateAll);

describe("anon cannot reach operational data", () => {
  beforeEach(async () => {
    const { programId } = await seedProgram({ capacity: 5 });
    await register(programId, "Private", { grade: "3rd" });
  });

  for (const table of [
    "registrations",
    "students",
    "parents",
    "enrollments",
    "schools",
    "programs",
    "coaches",
    "invoices",
    "payments",
    "attendance",
  ]) {
    it(`refuses anon reads of ops.${table}`, async () => {
      const { data, error } = await anonOps.from(table).select("*");

      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });
  }

  it("refuses anon writes to ops.registrations", async () => {
    const { error } = await anonOps.from("registrations").insert({
      program_id: "00000000-0000-0000-0000-000000000000",
      child_first_name: "Intruder",
      child_last_name: "Intruder",
      parent_first_name: "Intruder",
      parent_last_name: "Intruder",
      parent_phone: "+10000000000",
    });

    expect(error).not.toBeNull();
  });
});

describe("the public surface exposes counts but never people", () => {
  it("lets anon read aggregate availability", async () => {
    const { programId } = await seedProgram({ capacity: 4 });
    const { data: cms } = await adminPublic
      .from("programs")
      .insert({
        title: "Listing",
        description: "d",
        date_range: "d",
        location: "l",
        image: "i",
        slots: "s",
        price: "p",
        age_groups: ["6-8"],
        type: "current",
        ops_program_id: programId,
      })
      .select("id")
      .single();

    const { data, error } = await anonPublic
      .from("program_availability")
      .select("*")
      .eq("cms_program_id", cms!.id)
      .single();

    expect(error).toBeNull();
    expect(data!.capacity).toBe(4);
    expect(data!.seats_remaining).toBe(4);

    // The view must not carry anything identifying a child or parent.
    const columns = Object.keys(data!).join(" ");
    expect(columns).not.toMatch(/child|parent|phone|email|medical|student/i);
  });

  it("lets anon register without being able to read anything back", async () => {
    const { programId } = await seedProgram({ capacity: 2 });

    const { data, error } = await anonPublic.rpc("submit_registration", {
      p_program_id: programId,
      p_child_first_name: "Amina",
      p_child_last_name: "Yusuf",
      p_parent_first_name: "Sara",
      p_parent_last_name: "Yusuf",
      p_parent_phone: "+12145550100",
    });

    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row.status).toBe("confirmed");

    // The row landed, but anon still cannot see it.
    const { data: leaked } = await anonOps.from("registrations").select("*");
    expect(leaked).toBeNull();

    const { count } = await admin
      .from("registrations")
      .select("*", { count: "exact", head: true });
    expect(count).toBe(1);
  });

  it("throttles a single phone number hammering the endpoint", async () => {
    const { programId } = await seedProgram({ capacity: 50 });
    const phone = "+12145559999";

    for (let i = 0; i < 10; i++) {
      const { error } = await anonPublic.rpc("submit_registration", {
        p_program_id: programId,
        p_child_first_name: `Child${i}`,
        p_child_last_name: "Test",
        p_parent_first_name: "Parent",
        p_parent_last_name: "Test",
        p_parent_phone: phone,
      });
      expect(error).toBeNull();
    }

    const { error } = await anonPublic.rpc("submit_registration", {
      p_program_id: programId,
      p_child_first_name: "Eleventh",
      p_child_last_name: "Test",
      p_parent_first_name: "Parent",
      p_parent_last_name: "Test",
      p_parent_phone: phone,
    });

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/too many/i);
  });
});

describe("marketing CMS is readable but not writable by the public", () => {
  /**
   * Regression test for a real hole: `programs`, `partnerships`, and
   * `testimonials` shipped with a policy named for authenticated users that was
   * actually FOR ALL TO public USING (true) WITH CHECK (true). Anyone holding
   * the anon key could delete every program listing on the live site.
   */
  const seedRow: Record<string, () => Record<string, unknown>> = {
    programs: () => ({
      title: "Seed",
      description: "d",
      date_range: "d",
      location: "l",
      image: "i",
      slots: "s",
      price: "p",
      age_groups: ["6-8"],
      type: "current",
    }),
    testimonials: () => ({ name: "Seed", quote: "q", stars: 5, relationship: "parent" }),
    partnerships: () => ({ type: "Seed", icon: "*", description: "d", benefits: ["b"] }),
  };

  for (const table of ["programs", "testimonials", "partnerships"]) {
    it(`lets anon read ${table}`, async () => {
      await adminPublic.from(table).insert(seedRow[table]());

      const { data, error } = await anonPublic.from(table).select("*");

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThan(0);
    });

    it(`refuses anon inserts into ${table}`, async () => {
      const { error } = await anonPublic.from(table).insert(seedRow[table]());
      expect(error).not.toBeNull();
    });

    it(`refuses anon deletes from ${table}`, async () => {
      const { data: seeded } = await adminPublic
        .from(table)
        .insert(seedRow[table]())
        .select("id")
        .single();

      // RLS filters the row out rather than erroring, so assert on survival:
      // a delete that matched nothing is a delete that was refused.
      await anonPublic.from(table).delete().eq("id", seeded!.id);

      const { data: still } = await adminPublic
        .from(table)
        .select("id")
        .eq("id", seeded!.id)
        .maybeSingle();

      expect(still).not.toBeNull();
    });

    it(`refuses anon updates to ${table}`, async () => {
      const { data: seeded } = await adminPublic
        .from(table)
        .insert(seedRow[table]())
        .select("id")
        .single();

      await anonPublic.from(table).update({ description: "vandalised" }).eq("id", seeded!.id);

      const { data: after } = await adminPublic
        .from(table)
        .select("*")
        .eq("id", seeded!.id)
        .single();

      expect((after as Record<string, unknown>).description).not.toBe("vandalised");
    });
  }

  afterEach(async () => {
    for (const table of ["programs", "testimonials", "partnerships"]) {
      await adminPublic
        .from(table)
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
    }
  });
});
