import { NextRequest, NextResponse } from "next/server";
import { businessDaysAgo, businessToday } from "@/lib/dates";
import { createAdminSupabase } from "@/lib/supabase/server";
import { renderTemplate } from "shared";
import { generateMonthlyInvoices } from "@/lib/actions/payments";
import { chargeDueAutopay } from "@/lib/autopay";
import { payLink } from "@/lib/app-url";
import { getStripeClient } from "@/lib/stripe-client";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminSupabase();
  const results: Record<string, unknown> = { practiceReminders: 0, paymentReminders: 0 };

  async function getConfigValue(key: string): Promise<string> {
    const { data } = await supabase
      .from("config")
      .select("value")
      .eq("key", key)
      .single();
    return data?.value || "";
  }

  async function getTemplate(name: string): Promise<string> {
    const { data } = await supabase
      .from("message_templates")
      .select("body")
      .eq("name", name)
      .eq("is_active", true)
      .single();
    return data?.body || "";
  }

  // The month's invoices, on the 1st — the date they fall due. Autopay can only
  // charge an invoice that exists, so without this every family on autopay
  // would wait until someone remembered to press Generate. Only on the 1st: run
  // daily, it would bill a child who joined on the 20th for the whole month.
  const today = businessToday();
  if (today.endsWith("-01") && (await getConfigValue("auto_generate_invoices")) === "true") {
    results.invoicesGenerated = (await generateMonthlyInvoices(today.slice(0, 7))).created;
  }

  // Autopay before any reminder, so no family is chased for money being taken
  // today. A bank debit started here moves its invoice to 'processing', which
  // the overdue sweep below leaves alone while it settles.
  const stripe = await getStripeClient();
  if (stripe) {
    results.autopay = await chargeDueAutopay(supabase, stripe, today);
  }

  // Practice reminders for tomorrow's sessions
  const practiceEnabled = await getConfigValue("practice_reminders_enabled");
  if (practiceEnabled === "true") {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];

    const { data: sessions } = await supabase
      .from("sessions")
      .select("*, programs(*, schools(*))")
      .eq("date", tomorrowStr)
      .eq("status", "scheduled");

    const template = await getTemplate("practice_reminder_day_before");

    for (const session of sessions || []) {
      const program = session.programs as any;
      const school = program?.schools as any;

      const { data: enrollments } = await supabase
        .from("enrollments")
        .select("students(*, student_parents(parents(*)))")
        .eq("program_id", session.program_id)
        .eq("status", "active");

      for (const enrollment of enrollments || []) {
        const student = (enrollment as any).students;
        const parentLinks = student?.student_parents || [];

        for (const link of parentLinks) {
          const parent = link.parents;
          if (!parent?.phone) continue;

          const message = renderTemplate(template, {
            parent_name: `${parent.first_name}`,
            student_name: `${student.first_name}`,
            program_name: program?.name || "",
            school_name: school?.name || "",
            time: session.start_time?.slice(0, 5) || "",
          });

          await supabase.from("message_queue").insert({
            recipient_phone: parent.phone,
            recipient_name: `${parent.first_name} ${parent.last_name}`,
            message,
            status: "pending",
            attempts: 0,
            max_attempts: 3,
          });

          results.practiceReminders = (results.practiceReminders as number) + 1;
        }
      }
    }
  }

  // Payment reminders for overdue invoices
  const paymentEnabled = await getConfigValue("payment_reminders_enabled");
  if (paymentEnabled === "true") {
    const daysAfterDue = Number(await getConfigValue("payment_reminder_days_after_due")) || 3;
    const cutoffStr = businessDaysAgo(daysAfterDue);

    await supabase
      .from("invoices")
      .update({ status: "overdue" })
      .eq("status", "pending")
      .lt("due_date", businessToday());

    const { data: overdueInvoices } = await supabase
      .from("invoices")
      .select("*, parents(*), students(*), programs(*)")
      .eq("status", "overdue")
      .lte("due_date", cutoffStr);

    const template = await getTemplate("payment_reminder");

    for (const invoice of overdueInvoices || []) {
      const parent = invoice.parents as any;
      const student = invoice.students as any;
      const program = invoice.programs as any;

      if (!parent?.phone) continue;

      const message = renderTemplate(template, {
        parent_name: parent.first_name,
        student_name: `${student.first_name}`,
        program_name: program?.name || "",
        month: invoice.month,
        amount: `$${invoice.amount}`,
        payment_method: parent.preferred_payment || "cash",
        pay_link: parent.pay_token ? payLink(parent.pay_token) : "",
      });

      await supabase.from("message_queue").insert({
        recipient_phone: parent.phone,
        recipient_name: `${parent.first_name} ${parent.last_name}`,
        message,
        status: "pending",
        attempts: 0,
        max_attempts: 3,
      });

      results.paymentReminders = (results.paymentReminders as number) + 1;
    }
  }

  return NextResponse.json({
    success: true,
    ...results,
    timestamp: new Date().toISOString(),
  });
}
