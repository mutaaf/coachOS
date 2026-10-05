import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  admin,
  COMPLIANCE_USER,
  ensureComplianceUser,
  ensureTestUser,
  LOCAL,
  seedProgram,
  signedInClient,
  sql,
  TEST_USER,
  truncateAll,
} from "../helpers/db";
import { complianceMayOpen, homeFor, isAdmin, isStaff, staffRole } from "@/lib/admin";
import { inviteToCoachOS, listAccess, removeAccess } from "@/lib/actions/access";

/**
 * The compliance role — an assistant who researches policy facts — must
 * never see a family. Proven straight through the database's API with a real
 * signed-in session, on every table in `ops`, with sensitive rows present.
 */

// What the compliance role is meant to read.
const ALLOWED = new Set(["legal_facts", "legal_fact_versions", "legal_document_versions", "compliance_tasks", "compliance_task_completions", "audit_log"]);
// Seat counts per program — the public listing the /join page shows anyone,
// readable by every signed-in account since before this role existed. No
// person's details (checked below).
const PUBLIC_LISTING = new Set(["program_availability"]);

beforeAll(async () => {
  await ensureTestUser();
  await ensureComplianceUser();
  await truncateAll();
  // A family with a child's allergy, a payment, a message, an incident and a website question.
  const { programId } = await seedProgram();
  const { data: parent } = await admin.from("parents").insert({ first_name: "Hina", last_name: "Khan", phone: "+12145550188", email: "hina@example.com" }).select("id").single();
  const { data: child } = await admin.from("students").insert({ first_name: "Zara", last_name: "Khan", medical_notes: "Peanut allergy — EpiPen in bag" }).select("id").single();
  await admin.from("student_parents").insert({ student_id: child!.id, parent_id: parent!.id });
  await admin.from("registrations").insert({
    program_id: programId, child_first_name: "Zara", child_last_name: "Khan", parent_first_name: "Hina", parent_last_name: "Khan",
    parent_phone: "+12145550188", medical_notes: "Peanut allergy",
  });
  const { data: invoice } = await admin.from("invoices").insert({ parent_id: parent!.id, student_id: child!.id, program_id: programId, amount: 150, month: "2026-10-01", due_date: "2026-10-01" }).select("id").single();
  await admin.from("payments").insert({ invoice_id: invoice!.id, amount: 150, method: "zelle" });
  await admin.from("message_queue").insert({ recipient_phone: "+12145550188", recipient_name: "Hina", message: "Zara's practice is moved", parent_id: parent!.id });
  await admin.from("incidents").insert({ occurred_at: new Date().toISOString(), kind: "injury", student_id: child!.id, description: "Twisted ankle" });
  await admin.from("inquiries").insert({ kind: "general", first_name: "Hina", phone: "+12145550188", message: "Question" });
  await admin.from("audit_log").insert({ actor: "admin:boss@example.test", action: "medical.view", entity: "students", detail: { student_ids: [child!.id] } });
});
afterAll(truncateAll);

describe("the role itself", () => {
  it("compliance is staff but not admin, and lands on Audit & Compliance", () => {
    const c = { app_metadata: { role: "compliance" } };
    expect(isAdmin(c)).toBe(false);
    expect(isStaff(c)).toBe(true);
    expect(staffRole(c)).toBe("compliance");
    expect(homeFor("compliance")).toBe("/compliance");
    expect(homeFor("admin")).toBe("/dashboard");
    expect(staffRole({ app_metadata: { role: "Compliance" } })).toBeNull();
    // user_metadata is the user's own to edit; it never grants anything.
    expect(staffRole({ app_metadata: {}, user_metadata: { role: "compliance" } } as never)).toBeNull();
  });

  it("middleware lets the role open only Audit & Compliance", () => {
    expect(complianceMayOpen("/compliance")).toBe(true);
    for (const p of ["/dashboard", "/students", "/students/family/x", "/payments", "/messaging", "/registrations", "/coaches", "/settings", "/compliancex"]) {
      expect(complianceMayOpen(p), p).toBe(false);
    }
  });
});

describe("straight through the database's API, signed in as the compliance role", () => {
  it("reads no row of any operational table outside Audit & Compliance", async () => {
    const helper = await signedInClient(COMPLIANCE_USER);
    const tables = sql<{ name: string }>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'ops' UNION SELECT viewname FROM pg_views WHERE schemaname = 'ops'`).map((r) => r.name);
    expect(tables.length).toBeGreaterThan(30);
    for (const t of PUBLIC_LISTING) {
      const cols = sql<{ name: string }>(`SELECT attname AS name FROM pg_attribute WHERE attrelid = 'ops.${t}'::regclass AND attnum > 0 AND NOT attisdropped`);
      for (const c of cols) expect(c.name, `ops.${t}`).not.toMatch(/child|parent|phone|email|medical|student|notes|birth/i);
    }
    for (const t of tables.filter((t) => !ALLOWED.has(t) && !PUBLIC_LISTING.has(t))) {
      const { data } = await helper.from(t).select("*").limit(5);
      expect(data ?? [], `ops.${t}`).toEqual([]);
    }
  });

  it("in particular: no children, no medical notes, no families, payments or messages — though they exist", async () => {
    const helper = await signedInClient(COMPLIANCE_USER);
    for (const t of ["students", "registrations", "parents", "invoices", "payments", "message_queue", "incidents", "inquiries"]) {
      const { count } = await admin.from(t).select("*", { count: "exact", head: true });
      expect(count, `seeded ${t}`).toBeGreaterThan(0);
      expect((await helper.from(t).select("*")).data ?? [], t).toEqual([]);
    }
    const { data: medical } = await helper.from("students").select("medical_notes").not("medical_notes", "is", null);
    expect(medical ?? []).toEqual([]);
    const { data: log } = await helper.from("audit_log").select("action").eq("action", "medical.view");
    expect(log ?? []).toEqual([]);
  });

  it("changes nothing there either", async () => {
    const helper = await signedInClient(COMPLIANCE_USER);
    expect((await helper.from("students").insert({ first_name: "Planted", last_name: "Child" })).error).not.toBeNull();
    const { data: updated } = await helper.from("students").update({ medical_notes: "changed" }).neq("id", "00000000-0000-0000-0000-000000000000").select("id");
    expect(updated ?? []).toEqual([]);
    expect((await admin.from("students").select("medical_notes").eq("first_name", "Zara").single()).data?.medical_notes).toBe("Peanut allergy — EpiPen in bag");
    expect((await helper.from("audit_log").insert({ actor: "x", action: "legal.fact.save" })).error).not.toBeNull();
  });

  it("isn't an admin to the database or the website's CMS", async () => {
    const helper = await signedInClient(COMPLIANCE_USER);
    expect((await helper.rpc("is_admin")).data).toBe(false);
    expect((await helper.rpc("staff_role")).data).toBe("compliance");
    const site = await signedInClient(COMPLIANCE_USER, "public");
    expect((await site.rpc("is_admin")).data).toBe(false);
  });

  it("but reads policy facts and the checklist", async () => {
    const helper = await signedInClient(COMPLIANCE_USER);
    expect((await helper.from("legal_facts").select("key")).data?.length).toBe(47);
    expect((await helper.from("compliance_tasks").select("slug")).data?.length).toBe(8);
  });

  it("an admin still reads everything", async () => {
    const owner = await signedInClient(TEST_USER);
    expect((await owner.from("students").select("medical_notes").eq("first_name", "Zara")).data).toEqual([{ medical_notes: "Peanut allergy — EpiPen in bag" }]);
  });
});

describe("Settings → invite a compliance helper", () => {
  const email = "invited-helper@example.test";
  const authAdmin = createClient(LOCAL.url, LOCAL.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  async function cleanup() {
    const { data } = await authAdmin.auth.admin.listUsers();
    const u = data?.users?.find((x) => x.email === email);
    if (u) await authAdmin.auth.admin.deleteUser(u.id);
  }
  beforeAll(cleanup);
  afterAll(cleanup);

  it("creates the account with the compliance role, listed as such, and can be removed", async () => {
    const res = await inviteToCoachOS(email, "Sara", "compliance");
    expect(res).toMatchObject({ success: true, role: "compliance" });
    const { data } = await authAdmin.auth.admin.listUsers();
    const u = data!.users.find((x) => x.email === email)!;
    expect(u.app_metadata.role).toBe("compliance");

    const people = (await listAccess())!;
    expect(people.find((p) => p.email === email)?.role).toBe("compliance");
    expect(people.find((p) => p.email === TEST_USER.email)?.role).toBe("admin");

    // Promoting is the same invite with the other role.
    await inviteToCoachOS(email, "Sara", "admin");
    expect((await authAdmin.auth.admin.getUserById(u.id)).data.user?.app_metadata.role).toBe("admin");
    await inviteToCoachOS(email, "Sara", "compliance");

    expect(await removeAccess(u.id)).toEqual({ success: true });
    expect((await authAdmin.auth.admin.getUserById(u.id)).data.user?.app_metadata.role ?? null).toBeNull();
  });

  it("refuses a role that doesn't exist", async () => {
    expect(await inviteToCoachOS(email, "Sara", "owner" as never)).toEqual({ error: "Choose what they can see." });
  });
});
