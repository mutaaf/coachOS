import { describe, it, expect, afterEach } from "vitest";
import { admin, availability, register, seedProgram, truncateAll } from "../helpers/db";
import * as registrations from "@/lib/actions/registrations";
import { businessMonth } from "@/lib/dates";

/**
 * The buttons on Registrations (issue #25). Each one used to change a label
 * and nothing behind it: "Mark paid" showed Paid with no money received, "Add
 * to roster" put a child in the session with no bill, the X cancelled a child
 * who stayed enrolled and billed, and "Give a seat" went to whoever was tapped
 * — usually the newest, not the family first in line.
 */

afterEach(truncateAll);

const { convertRegistration, cancelRegistration, restoreRegistration, promoteFromWaitlist, promoteNextInLine } =
  registrations as any;

async function registrationOf(programId: string, child: string) {
  const { data } = await admin
    .from("registrations")
    .select("*")
    .eq("program_id", programId)
    .eq("child_first_name", child)
    .single();
  return data!;
}

async function invoicesFor(programId: string) {
  const { data } = await admin
    .from("invoices")
    .select("id, amount, month, status, due_date, parent_id, student_id")
    .eq("program_id", programId);
  return data ?? [];
}

describe("Mark paid", () => {
  it("is gone: a registration can't be called paid without a payment behind it", () => {
    expect("setRegistrationPaymentStatus" in registrations).toBe(false);
  });
});

describe("Add to roster", () => {
  it("bills the first month, to the parent who registered, due a week from today", async () => {
    const { programId } = await seedProgram({ monthlyFee: 150 });
    await register(programId, "Amina");
    const reg = await registrationOf(programId, "Amina");

    expect(await convertRegistration(reg.id)).toEqual({ success: true });

    const after = await registrationOf(programId, "Amina");
    const invoices = await invoicesFor(programId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({
      amount: 150,
      month: businessMonth(),
      status: "pending",
      parent_id: after.parent_id,
      student_id: after.student_id,
    });
    // A child joining mid-month is never overdue the day they join.
    expect(invoices[0].due_date >= `${businessMonth()}-01`).toBe(true);
  });

  it("doesn't bill a free program, or one that hasn't started yet", async () => {
    const free = await seedProgram({ monthlyFee: 0 });
    await register(free.programId, "Free");
    expect(await convertRegistration((await registrationOf(free.programId, "Free")).id)).toEqual({ success: true });
    expect(await invoicesFor(free.programId)).toHaveLength(0);

    const later = await seedProgram({ monthlyFee: 150 });
    await admin.from("programs").update({ start_date: "2099-01-05" }).eq("id", later.programId);
    await register(later.programId, "Later");
    expect(await convertRegistration((await registrationOf(later.programId, "Later")).id)).toEqual({ success: true });
    expect(await invoicesFor(later.programId)).toHaveLength(0);
  });
});

describe("Cancel", () => {
  async function onRoster() {
    const { programId } = await seedProgram({ capacity: 1, monthlyFee: 150 });
    await register(programId, "Amina");
    const reg = await registrationOf(programId, "Amina");
    await convertRegistration(reg.id);
    return { programId, reg: await registrationOf(programId, "Amina") };
  }

  it("can take the child off the roster too, so they are not billed", async () => {
    const { programId, reg } = await onRoster();

    expect(await cancelRegistration(reg.id, { withdraw: true })).toEqual({ success: true });

    expect((await registrationOf(programId, "Amina")).status).toBe("cancelled");
    const { data: enrollment } = await admin.from("enrollments").select("status").eq("id", reg.enrollment_id).single();
    expect(enrollment!.status).toBe("withdrawn");
    // The bill Add to roster made, not yet due and nothing paid, goes.
    expect(await invoicesFor(programId)).toHaveLength(0);
    expect((await availability(programId)).seats_remaining).toBe(1);
  });

  it("never touches money already paid", async () => {
    const { programId, reg } = await onRoster();
    const [invoice] = await invoicesFor(programId);
    await admin.from("payments").insert({ invoice_id: invoice.id, amount: 150, method: "cash" });
    await admin.from("invoices").update({ status: "paid" }).eq("id", invoice.id);

    expect(await cancelRegistration(reg.id, { withdraw: true })).toEqual({ success: true });
    expect(await invoicesFor(programId)).toMatchObject([{ id: invoice.id, status: "paid" }]);
  });

  it("leaves the child on the roster when the Boss says so", async () => {
    const { programId, reg } = await onRoster();
    expect(await cancelRegistration(reg.id, { withdraw: false })).toEqual({ success: true });
    const { data: enrollment } = await admin.from("enrollments").select("status").eq("id", reg.enrollment_id).single();
    expect(enrollment!.status).toBe("active");
    expect(await invoicesFor(programId)).toHaveLength(1);
  });

  it("can be undone: Restore puts the child back on the roster and bills them again", async () => {
    const { programId, reg } = await onRoster();
    await cancelRegistration(reg.id, { withdraw: true });

    expect(await restoreRegistration(reg.id)).toMatchObject({ success: true, status: "confirmed" });

    expect((await registrationOf(programId, "Amina")).status).toBe("confirmed");
    const { data: enrollment } = await admin.from("enrollments").select("status").eq("id", reg.enrollment_id).single();
    expect(enrollment!.status).toBe("active");
    expect(await invoicesFor(programId)).toHaveLength(1);
  });

  it("restores to the back of the waitlist when the seat has gone", async () => {
    const { programId } = await seedProgram({ capacity: 1 });
    await register(programId, "Amina");
    const amina = await registrationOf(programId, "Amina");
    await cancelRegistration(amina.id, { withdraw: false });
    await register(programId, "Bilal"); // takes the freed seat

    expect(await restoreRegistration(amina.id)).toMatchObject({ success: true, status: "waitlisted" });
    expect(await registrationOf(programId, "Amina")).toMatchObject({ status: "waitlisted", waitlist_position: 1 });
  });

  it("closes the gap in the waitlist", async () => {
    const { programId } = await seedProgram({ capacity: 1 });
    for (const child of ["Seated", "First", "Second", "Third"]) await register(programId, child);

    await cancelRegistration((await registrationOf(programId, "First")).id, { withdraw: false });

    expect((await registrationOf(programId, "Second")).waitlist_position).toBe(1);
    expect((await registrationOf(programId, "Third")).waitlist_position).toBe(2);
  });
});

describe("Give a seat", () => {
  async function fullWithWaitlist() {
    const { programId } = await seedProgram({ capacity: 1 });
    await register(programId, "Seated");
    for (const child of ["First", "Second", "Third"]) await register(programId, child);
    // A seat opens.
    await admin.from("registrations").update({ status: "cancelled" }).eq("id", (await registrationOf(programId, "Seated")).id);
    return programId;
  }

  it("won't skip the family first in line without saying so", async () => {
    const programId = await fullWithWaitlist();
    const second = await registrationOf(programId, "Second");

    const result = await promoteFromWaitlist(second.id);
    expect(result).toMatchObject({ ahead: { name: "First Tester", position: 1 } });
    expect((await registrationOf(programId, "Second")).status).toBe("waitlisted");

    // She has been told, and chooses to anyway.
    expect(await promoteFromWaitlist(second.id, { outOfTurn: true })).toEqual({ success: true });
    expect((await registrationOf(programId, "Second")).status).toBe("confirmed");
    expect((await registrationOf(programId, "First")).waitlist_position).toBe(1);
    expect((await registrationOf(programId, "Third")).waitlist_position).toBe(2);
  });

  it("gives the seat to the next in line, and moves everyone else up", async () => {
    const programId = await fullWithWaitlist();

    expect(await promoteNextInLine(programId)).toEqual({ success: true, name: "First Tester" });

    expect((await registrationOf(programId, "First")).status).toBe("confirmed");
    expect((await registrationOf(programId, "Second")).waitlist_position).toBe(1);
    expect((await registrationOf(programId, "Third")).waitlist_position).toBe(2);
  });
});
