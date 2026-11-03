import { describe, it, expect, afterEach } from "vitest";
import { admin, anonOps, anonPublic, seedProgram, sql, truncateAll } from "../helpers/db";
import {
  eraseFamily,
  exportFamilyData,
  extendPrivacyDeadline,
  linkPrivacyFamily,
  updatePrivacyStatus,
} from "@/lib/actions/privacy";
import { getInquiries } from "@/lib/queries/inquiries";
import { getPrivacyRequests } from "@/lib/queries/compliance";
import { canMove, deadline } from "@/lib/privacy";

/**
 * A parent's right to see, correct and erase what we hold (Texas Data Privacy
 * and Security Act): the request arrives with its 45-day clock, is worked
 * through a workflow staff can't skip, and erasure removes the people while
 * keeping the money.
 */

afterEach(truncateAll);

let n = 0;
const phone = () => `+1682555${String(++n).padStart(4, "0")}`;
const DAY = 86_400_000;

async function privacyRequest(contact: Record<string, unknown>, details: Record<string, unknown>) {
  return anonPublic.rpc("submit_inquiry", { p_kind: "privacy_request", p_contact: contact, p_details: details, p_attribution: null });
}

/** A family with a child, an invoice and a payment, a message and an email. */
async function family() {
  const { programId } = await seedProgram();
  const p = phone();
  const { data: parent } = await admin
    .from("parents")
    .insert({ first_name: "Maya", last_name: "Reyes", phone: p, email: `maya${n}@example.com`, zelle_identifier: "maya@bank" })
    .select("*")
    .single();
  const { data: child } = await admin
    .from("students")
    .insert({ first_name: "Leo", last_name: "Reyes", date_of_birth: "2018-04-02", medical_notes: "Asthma inhaler" })
    .select("*")
    .single();
  await admin.from("student_parents").insert({ student_id: child!.id, parent_id: parent!.id });
  await admin.from("enrollments").insert({ student_id: child!.id, program_id: programId, status: "withdrawn" });
  const { data: invoice } = await admin
    .from("invoices")
    .insert({ parent_id: parent!.id, student_id: child!.id, program_id: programId, amount: 150, month: "2026-09", due_date: "2026-09-01", status: "paid", notes: "Paid by Maya" })
    .select("id")
    .single();
  await admin.from("payments").insert({ invoice_id: invoice!.id, amount: 150, method: "zelle", notes: "From Maya Reyes" });
  await admin.from("message_queue").insert({ recipient_phone: p, recipient_name: "Maya", message: "Leo's practice is at 5" });
  await admin.from("emails").insert({ dedupe_key: `receipt:${n}`, kind: "receipt", parent_id: parent!.id, to_address: parent!.email, subject: "Receipt for Leo", body_text: "Thanks Maya" });
  return { programId, parent: parent!, child: child!, invoiceId: invoice!.id as string };
}

describe("a privacy request from the website", () => {
  it("arrives with a 45-day deadline (60 for an appeal), matched to the family, and stays off the Marketing page", async () => {
    const f = await family();
    const before = Date.now();
    const { data: id, error } = await privacyRequest(
      { first_name: "Maya", phone: f.parent.phone },
      { request_type: "delete", child_first_names: ["Leo", ""], message: "Please delete us" }
    );
    expect(error).toBeNull();
    const { data: row } = await admin.from("inquiries").select("*").eq("id", id).single();
    expect(row).toMatchObject({ kind: "privacy_request", request_type: "delete", privacy_status: "received", parent_id: f.parent.id, child_first_names: ["Leo"] });
    const days = (new Date(row!.due_at).getTime() - before) / DAY;
    expect(days).toBeGreaterThan(44.9);
    expect(days).toBeLessThan(45.1);

    const { data: appealId } = await privacyRequest({ email: "x@example.com" }, { request_type: "appeal" });
    const { data: appeal } = await admin.from("inquiries").select("due_at").eq("id", appealId).single();
    expect((new Date(appeal!.due_at).getTime() - before) / DAY).toBeGreaterThan(59.9);

    expect((await getInquiries()).map((i) => i.id)).not.toContain(id);
    expect((await getPrivacyRequests()).map((r) => r.id)).toContain(id);
    // And an audit row says it arrived.
    const { data: audit } = await admin.from("audit_log").select("action").eq("entity_id", id);
    expect(audit!.map((a) => a.action)).toContain("privacy.received");
  });

  it("refuses a request without a known type", async () => {
    expect((await privacyRequest({ phone: phone() }, { request_type: "sell_it" })).error?.message).toMatch(/choose what you would like/i);
    expect((await privacyRequest({ phone: phone() }, {})).error?.message).toMatch(/choose/i);
  });
});

describe("working it", () => {
  it("can't skip checking it's them, needs a reason to decline, and extends once", async () => {
    const { data: id } = await privacyRequest({ phone: phone() }, { request_type: "access" });
    expect(await updatePrivacyStatus(id, "completed")).toMatchObject({ error: expect.stringMatching(/can't be moved/) });
    expect(await updatePrivacyStatus(id, "denied")).toMatchObject({ error: expect.stringMatching(/Say why/) });

    expect(await extendPrivacyDeadline(id, "")).toMatchObject({ error: expect.any(String) });
    const { data: before } = await admin.from("inquiries").select("due_at").eq("id", id).single();
    expect(await extendPrivacyDeadline(id, "Records are in storage")).toEqual({ success: true });
    const { data: after } = await admin.from("inquiries").select("due_at").eq("id", id).single();
    expect((new Date(after!.due_at).getTime() - new Date(before!.due_at).getTime()) / DAY).toBeCloseTo(45, 3);
    expect(await extendPrivacyDeadline(id, "again")).toMatchObject({ error: expect.stringMatching(/already been extended/) });

    expect(await updatePrivacyStatus(id, "verifying", { verificationMethod: "Called the number on file" })).toEqual({ success: true });
    expect(await updatePrivacyStatus(id, "denied", { reason: "Could not verify" })).toEqual({ success: true });
    expect(await updatePrivacyStatus(id, "appealed")).toEqual({ success: true });
    const { data: appealed } = await admin.from("inquiries").select("appeal_due_at").eq("id", id).single();
    expect(appealed!.appeal_due_at).toBeTruthy();
    expect(await updatePrivacyStatus(id, "appeal_denied")).toMatchObject({ error: expect.any(String) });
    expect(await updatePrivacyStatus(id, "appeal_denied", { reason: "Still can't verify; you may contact the Texas AG" })).toEqual({ success: true });
  });

  it("knows how long is left", () => {
    const now = new Date("2026-10-05T12:00:00Z");
    expect(deadline({ privacy_status: "received", due_at: "2026-10-06T12:00:00Z" }, now)).toMatchObject({ daysLeft: 1, state: "soon" });
    expect(deadline({ privacy_status: "verifying", due_at: "2026-10-01T12:00:00Z" }, now).state).toBe("overdue");
    expect(deadline({ privacy_status: "completed", due_at: "2026-10-01T12:00:00Z" }, now).state).toBe("closed");
    expect(canMove("received", "completed")).toBe(false);
  });
});

describe("export", () => {
  it("gives the family everything held about them, without the secrets that act for them", async () => {
    const f = await family();
    const result = await exportFamilyData(f.parent.id);
    expect(result).toMatchObject({ success: true });
    const doc = JSON.parse((result as { json: string }).json);
    expect(doc.parent.first_name).toBe("Maya");
    expect(doc.parent.pay_token).toBeUndefined();
    expect(doc.children[0]).toMatchObject({ first_name: "Leo", medical_notes: "Asthma inhaler", date_of_birth: "2018-04-02" });
    for (const key of ["enrollments", "invoices", "payments", "messages", "emails", "registrations", "inquiries", "consent_history", "attendance", "credits"]) {
      expect(Array.isArray(doc[key]), key).toBe(true);
    }
    expect(doc.invoices).toHaveLength(1);
    expect(doc.messages[0].message).toContain("Leo");
    const { data: audit } = await admin.from("audit_log").select("action").eq("entity_id", f.parent.id);
    expect(audit!.map((a) => a.action)).toContain("privacy.export");
  });
});

describe("erasure", () => {
  it("only on a request that has been checked, never while a child is enrolled, and only with ERASE", async () => {
    const f = await family();
    const { data: id } = await privacyRequest({ phone: f.parent.phone }, { request_type: "delete" });
    expect(await eraseFamily(f.parent.id, id, "ERASE")).toMatchObject({ error: expect.stringMatching(/Check it's really them/) });
    await updatePrivacyStatus(id, "verifying", { verificationMethod: "call" });
    expect(await eraseFamily(f.parent.id, id, "yes")).toMatchObject({ error: expect.stringMatching(/Type ERASE/) });

    await admin.from("enrollments").update({ status: "active" }).eq("student_id", f.child.id);
    expect(await eraseFamily(f.parent.id, id, "ERASE")).toMatchObject({ error: expect.stringMatching(/still enrolled/) });
  });

  it("removes who they were and keeps what was paid, with the request and an audit row as the record", async () => {
    const f = await family();
    const { data: id } = await privacyRequest({ phone: f.parent.phone, first_name: "Maya" }, { request_type: "delete" });
    await linkPrivacyFamily(id, f.parent.id);
    await updatePrivacyStatus(id, "verifying", { verificationMethod: "call" });
    const result = await eraseFamily(f.parent.id, id, "ERASE");
    expect(result).toMatchObject({ success: true, counts: { children: 1, invoices_kept: 1 } });

    const { data: parent } = await admin.from("parents").select("*").eq("id", f.parent.id).single();
    expect(parent).toMatchObject({ first_name: "Deleted", email: null, phone: "deleted", zelle_identifier: null });
    expect(parent!.pay_token).not.toBe(f.parent.pay_token);
    const { data: child } = await admin.from("students").select("*").eq("id", f.child.id).single();
    expect(child).toMatchObject({ first_name: "Deleted", date_of_birth: null, medical_notes: null });

    const { data: invoice } = await admin.from("invoices").select("amount, month, status, notes").eq("id", f.invoiceId).single();
    expect(invoice).toEqual({ amount: 150, month: "2026-09", status: "paid", notes: null });
    const { data: payments } = await admin.from("payments").select("amount, notes").eq("invoice_id", f.invoiceId);
    expect(payments).toEqual([{ amount: 150, notes: null }]);

    const { data: msgs } = await admin.from("message_queue").select("message, recipient_phone");
    expect(msgs!.every((m) => !m.message.includes("Leo") && m.recipient_phone === "deleted")).toBe(true);
    const { data: mail } = await admin.from("emails").select("body_text, to_address").eq("parent_id", f.parent.id);
    expect(mail![0]).toMatchObject({ to_address: "deleted" });

    const { data: req } = await admin.from("inquiries").select("privacy_status, phone, completed_at").eq("id", id).single();
    expect(req).toMatchObject({ privacy_status: "completed", phone: f.parent.phone });
    const { data: audit } = await admin.from("audit_log").select("action, detail").eq("entity_id", f.parent.id).eq("action", "privacy.anonymize");
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit![0].detail)).not.toMatch(/Maya|Leo|Asthma/);
  });

  it("can't be reached by the public, and the audit log can't be rewritten", async () => {
    const [row] = sql<Record<string, boolean>>(`
      SELECT has_function_privilege('anon', 'ops.anonymize_family(uuid, uuid, text, uuid)', 'EXECUTE') AS anon_erase,
             has_function_privilege('authenticated', 'ops.anonymize_family(uuid, uuid, text, uuid)', 'EXECUTE') AS auth_erase,
             has_function_privilege('anon', 'ops.export_family(uuid, text, uuid)', 'EXECUTE') AS anon_export,
             has_function_privilege('authenticated', 'ops.export_family(uuid, text, uuid)', 'EXECUTE') AS auth_export`);
    expect(Object.values(row).every((v) => v === false)).toBe(true);
    expect((await anonOps.from("audit_log").select("*")).data).toBeNull();

    const { data: entry } = await admin.from("audit_log").insert({ actor: "test", action: "test.entry" }).select("id").single();
    const { error: upd } = await admin.from("audit_log").update({ action: "changed" }).eq("id", entry!.id);
    expect(upd).not.toBeNull();
    const { error: del } = await admin.from("audit_log").delete().eq("id", entry!.id);
    expect(del).not.toBeNull();
  });
});
