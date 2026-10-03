import { describe, it, expect, afterEach } from "vitest";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { archiveStudent, deleteParent, deleteStudent, restoreStudent } from "@/lib/actions/students";

/**
 * Issue #11: deleting a withdrawn child took their paid invoice and its cash
 * payment with them, and so did deleting an unlinked parent. Payment history
 * stays; a child with any is archived instead.
 */

afterEach(truncateAll);

/** A withdrawn child whose parent is unlinked, with a paid $100 invoice. */
async function paidFamily() {
  const { programId } = await seedProgram();
  const { data: p } = await admin.from("parents").insert({ first_name: "Sara", last_name: "Yusuf", phone: "+12145550001" }).select("id").single();
  const { data: s } = await admin.from("students").insert({ first_name: "Theo", last_name: "Yusuf" }).select("id").single();
  await admin.from("enrollments").insert({ student_id: s!.id, program_id: programId, status: "withdrawn" });
  const { data: inv } = await admin
    .from("invoices")
    .insert({ parent_id: p!.id, student_id: s!.id, program_id: programId, amount: 100, month: "2026-09", due_date: "2026-09-01", status: "paid" })
    .select("id")
    .single();
  await admin.from("payments").insert({ invoice_id: inv!.id, amount: 100, method: "cash" });
  return { parentId: p!.id as string, studentId: s!.id as string, invoiceId: inv!.id as string };
}

async function history(invoiceId: string) {
  const { count: invoices } = await admin.from("invoices").select("id", { count: "exact", head: true }).eq("id", invoiceId);
  const { count: payments } = await admin.from("payments").select("id", { count: "exact", head: true }).eq("invoice_id", invoiceId);
  return { invoices, payments };
}

describe("deleting someone with payment history", () => {
  it("refuses to delete a withdrawn child who has invoices, and offers Archive", async () => {
    const { studentId, invoiceId } = await paidFamily();

    const result = await deleteStudent(studentId);

    expect(result).toHaveProperty("error", expect.stringMatching(/archive/i));
    expect(result).toHaveProperty("canArchive", true);
    expect(await history(invoiceId)).toEqual({ invoices: 1, payments: 1 });
    const { data } = await admin.from("students").select("id").eq("id", studentId);
    expect(data).toHaveLength(1);
  });

  it("refuses to delete an unlinked parent who has invoices", async () => {
    const { parentId, invoiceId } = await paidFamily();

    expect(await deleteParent(parentId)).toHaveProperty("error");
    expect(await history(invoiceId)).toEqual({ invoices: 1, payments: 1 });
  });

  it("refuses at the database too, so nothing can cascade the history away", async () => {
    const { parentId, studentId, invoiceId } = await paidFamily();

    expect((await admin.from("students").delete().eq("id", studentId)).error).not.toBeNull();
    expect((await admin.from("parents").delete().eq("id", parentId)).error).not.toBeNull();
    expect((await admin.from("invoices").delete().eq("id", invoiceId)).error).not.toBeNull();
    expect(await history(invoiceId)).toEqual({ invoices: 1, payments: 1 });
  });

  it("still deletes a child and a parent who have no history", async () => {
    const { data: p } = await admin.from("parents").insert({ first_name: "New", last_name: "Parent", phone: "+12145550002" }).select("id").single();
    const { data: s } = await admin.from("students").insert({ first_name: "New", last_name: "Child" }).select("id").single();
    await admin.from("student_parents").insert({ student_id: s!.id, parent_id: p!.id });

    expect(await deleteStudent(s!.id)).toEqual({ success: true });
    expect(await deleteParent(p!.id)).toEqual({ success: true });
  });
});

describe("archiving a child", () => {
  it("takes them off the active list and keeps their history, and can be undone", async () => {
    const { studentId, invoiceId } = await paidFamily();

    expect(await archiveStudent(studentId)).not.toHaveProperty("error");
    let { data } = await admin.from("students").select("status").eq("id", studentId).single();
    expect(data!.status).toBe("inactive");
    expect(await history(invoiceId)).toEqual({ invoices: 1, payments: 1 });

    expect(await restoreStudent(studentId)).not.toHaveProperty("error");
    ({ data } = await admin.from("students").select("status").eq("id", studentId).single());
    expect(data!.status).toBe("active");
  });

  it("refuses a child still in a session, who would keep being invoiced", async () => {
    const { programId } = await seedProgram();
    const { data: s } = await admin.from("students").insert({ first_name: "Ada", last_name: "Lee" }).select("id").single();
    await admin.from("enrollments").insert({ student_id: s!.id, program_id: programId, status: "active" });

    expect(await archiveStudent(s!.id)).toHaveProperty("error", expect.stringMatching(/withdraw/i));
    const { data } = await admin.from("students").select("status").eq("id", s!.id).single();
    expect(data!.status).toBe("active");
  });
});
