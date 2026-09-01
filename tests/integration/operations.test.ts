import { describe, it, expect, afterEach } from "vitest";
import { admin, seedProgram, truncateAll } from "../helpers/db";
import { generateSessions, recordAttendance } from "@/lib/actions/schedule";
import { generateMonthlyInvoices, recordPayment } from "@/lib/actions/payments";

/**
 * The three things the business runs on every week: sessions on the calendar,
 * attendance against them, and invoices that add up to the right amount.
 *
 * These import the app's real server actions rather than reimplementing them,
 * so a bug in the action is a failing test here.
 */

afterEach(truncateAll);

/** A child on a program's roster, with one parent linked. */
async function enrolledChild(
  programId: string,
  firstName: string,
  parents: { firstName: string; phone: string }[]
) {
  const { data: student } = await admin
    .from("students")
    .insert({ first_name: firstName, last_name: "Tester" })
    .select("id")
    .single();

  for (const p of parents) {
    const { data: parent } = await admin
      .from("parents")
      .insert({ first_name: p.firstName, last_name: "Tester", phone: p.phone })
      .select("id")
      .single();
    await admin
      .from("student_parents")
      .insert({ student_id: student!.id, parent_id: parent!.id, relationship: "parent" });
  }

  await admin
    .from("enrollments")
    .insert({ student_id: student!.id, program_id: programId, status: "active" });

  return student!.id;
}

describe("generating sessions from a weekly schedule", () => {
  /**
   * Every day of the week is exercised because the offset from today to the
   * session's weekday is what the calculation gets wrong: a day earlier in the
   * week than today used to silently lose one occurrence.
   */
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
    it(`creates one session per week for day ${dayOfWeek}`, async () => {
      const { programId } = await seedProgram({});
      await admin.from("schedule_templates").insert({
        program_id: programId,
        day_of_week: dayOfWeek,
        start_time: "16:00",
        end_time: "17:00",
        location: "Gym",
      });

      const result = await generateSessions(programId, 6);
      expect(result.error).toBeUndefined();

      const { data: sessions } = await admin
        .from("sessions")
        .select("date")
        .eq("program_id", programId)
        .order("date");

      expect(sessions).toHaveLength(6);

      // Every session must fall on the requested weekday...
      for (const s of sessions!) {
        expect(new Date(`${s.date}T12:00:00`).getDay()).toBe(dayOfWeek);
      }

      // ...and be exactly seven days apart, with no duplicates.
      const dates = sessions!.map((s) => s.date);
      expect(new Set(dates).size).toBe(6);
      for (let i = 1; i < dates.length; i++) {
        const gap =
          (new Date(`${dates[i]}T12:00:00`).getTime() -
            new Date(`${dates[i - 1]}T12:00:00`).getTime()) /
          86_400_000;
        expect(gap).toBe(7);
      }
    });
  }

  it("does not duplicate sessions when run twice", async () => {
    const { programId } = await seedProgram({});
    await admin.from("schedule_templates").insert({
      program_id: programId,
      day_of_week: 2,
      start_time: "16:00",
      end_time: "17:00",
    });

    await generateSessions(programId, 4);
    await generateSessions(programId, 4);

    const { count } = await admin
      .from("sessions")
      .select("*", { count: "exact", head: true })
      .eq("program_id", programId);

    expect(count).toBe(4);
  });

  it("says so rather than failing silently when there is no schedule", async () => {
    const { programId } = await seedProgram({});
    const result = await generateSessions(programId, 4);
    expect(result.error).toMatch(/no schedule templates/i);
  });
});

describe("attendance", () => {
  it("records who was there", async () => {
    const { programId } = await seedProgram({});
    const studentId = await enrolledChild(programId, "Amina", [
      { firstName: "Sara", phone: "+12145550001" },
    ]);

    const { data: session } = await admin
      .from("sessions")
      .insert({
        program_id: programId,
        date: new Date().toISOString().split("T")[0],
        start_time: "16:00",
        end_time: "17:00",
        status: "scheduled",
      })
      .select("id")
      .single();

    await recordAttendance(session!.id, [{ studentId, status: "present" }]);

    const { data: rows } = await admin
      .from("attendance")
      .select("student_id, status")
      .eq("session_id", session!.id);

    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ student_id: studentId, status: "present" });
  });
});

describe("monthly invoicing", () => {
  it("bills one invoice per child", async () => {
    const { programId } = await seedProgram({ monthlyFee: 150 });
    await enrolledChild(programId, "Amina", [{ firstName: "Sara", phone: "+12145550001" }]);

    const result = await generateMonthlyInvoices("2026-09");

    expect(result.created).toBe(1);

    const { data: invoices } = await admin.from("invoices").select("amount, month, status");
    expect(invoices).toHaveLength(1);
    expect(Number(invoices![0].amount)).toBe(150);
    expect(invoices![0].status).toBe("pending");
  });

  /**
   * The one that matters most. A child with both parents on file is one child
   * and one fee — billing each parent separately charges the family twice.
   */
  it("bills a child with two linked parents once, not twice", async () => {
    const { programId } = await seedProgram({ monthlyFee: 150 });
    await enrolledChild(programId, "Amina", [
      { firstName: "Sara", phone: "+12145550001" },
      { firstName: "Yusuf", phone: "+12145550002" },
    ]);

    await generateMonthlyInvoices("2026-09");

    const { data: invoices } = await admin.from("invoices").select("amount");
    expect(invoices).toHaveLength(1);

    const owed = invoices!.reduce((sum, i) => sum + Number(i.amount), 0);
    expect(owed).toBe(150);
  });

  it("is safe to run twice for the same month", async () => {
    const { programId } = await seedProgram({ monthlyFee: 150 });
    await enrolledChild(programId, "Amina", [{ firstName: "Sara", phone: "+12145550001" }]);

    await generateMonthlyInvoices("2026-09");
    const second = await generateMonthlyInvoices("2026-09");

    expect(second.created).toBe(0);

    const { count } = await admin
      .from("invoices")
      .select("*", { count: "exact", head: true });
    expect(count).toBe(1);
  });

  it("does not bill withdrawn children", async () => {
    const { programId } = await seedProgram({ monthlyFee: 150 });
    const studentId = await enrolledChild(programId, "Left", [
      { firstName: "Sara", phone: "+12145550003" },
    ]);
    await admin
      .from("enrollments")
      .update({ status: "withdrawn" })
      .eq("student_id", studentId);

    const result = await generateMonthlyInvoices("2026-09");

    expect(result.created).toBe(0);
  });

  it("reports children it could not bill because no parent is on file", async () => {
    const { programId } = await seedProgram({ monthlyFee: 150 });
    await enrolledChild(programId, "Orphaned", []);

    const result = await generateMonthlyInvoices("2026-09");

    expect(result.created).toBe(0);
    // Silently skipping would mean a child attends all term and is never billed.
    expect(result.noParent).toBe(1);
  });
});

describe("recording a payment", () => {
  async function invoiceFor(fee: number) {
    const { programId } = await seedProgram({ monthlyFee: fee });
    await enrolledChild(programId, "Amina", [{ firstName: "Sara", phone: "+12145550001" }]);
    await generateMonthlyInvoices("2026-09");
    const { data } = await admin.from("invoices").select("id, parent_id").single();
    return data!;
  }

  function form(fields: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  }

  it("marks an invoice paid when the full amount is recorded", async () => {
    const invoice = await invoiceFor(150);

    await recordPayment(
      form({
        invoice_id: invoice.id,
        parent_id: invoice.parent_id,
        amount: "150",
        method: "zelle",
        paid_at: "2026-09-05",
      })
    );

    const { data: after } = await admin
      .from("invoices")
      .select("status")
      .eq("id", invoice.id)
      .single();
    expect(after!.status).toBe("paid");
  });

  it("leaves an invoice pending when only part is paid", async () => {
    const invoice = await invoiceFor(150);

    await recordPayment(
      form({
        invoice_id: invoice.id,
        parent_id: invoice.parent_id,
        amount: "50",
        method: "cash",
        paid_at: "2026-09-05",
      })
    );

    const { data: after } = await admin
      .from("invoices")
      .select("status")
      .eq("id", invoice.id)
      .single();
    expect(after!.status).toBe("pending");
  });

  it("keeps the payment method, since most money still arrives by Zelle or Venmo", async () => {
    const invoice = await invoiceFor(150);

    await recordPayment(
      form({
        invoice_id: invoice.id,
        parent_id: invoice.parent_id,
        amount: "150",
        method: "venmo",
        reference: "note-123",
        paid_at: "2026-09-05",
      })
    );

    const { data: payment } = await admin
      .from("payments")
      .select("method, reference, amount")
      .single();
    expect(payment!.method).toBe("venmo");
    expect(payment!.reference).toBe("note-123");
    expect(Number(payment!.amount)).toBe(150);
  });
});
