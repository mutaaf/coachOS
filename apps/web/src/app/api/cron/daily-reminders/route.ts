import { NextRequest, NextResponse } from "next/server";
import { businessDaysAgo, businessToday, businessTomorrow } from "@/lib/dates";
import { createAdminSupabase } from "@/lib/supabase/server";
import { renderTemplate } from "shared";
import { createMonthlyInvoices } from "@/lib/invoices";
import { chargeDueAutopay } from "@/lib/autopay";
import { payLink } from "@/lib/app-url";
import { toCents } from "@/lib/invoice-status";
import { emailReminder, emailRegistration } from "@/lib/parent-emails";
import { getStripeClient, getStripeSettings } from "@/lib/stripe-client";

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

  // The month's invoices, on the 1st, due on the Payment Due Day. Autopay can only
  // charge an invoice that exists, so without this every family on autopay
  // would wait until someone remembered to press Generate. Only on the 1st: run
  // daily, it would bill a child who joined on the 20th for the whole month.
  const today = businessToday();
  if (today.endsWith("-01") && (await getConfigValue("auto_generate_invoices")) === "true") {
    results.invoicesGenerated = (await createMonthlyInvoices(today.slice(0, 7))).created;
  }

  // Autopay before any reminder, so no family is chased for money being taken
  // today. A bank debit started here moves its invoice to 'processing', which
  // the overdue sweep below leaves alone while it settles.
  const stripe = await getStripeClient();
  if (stripe) {
    const { mode } = await getStripeSettings();
    results.autopay = await chargeDueAutopay(supabase, stripe, today, mode);
  }

  // Practice reminders for tomorrow's sessions
  const practiceEnabled = await getConfigValue("practice_reminders_enabled");
  if (practiceEnabled === "true") {
    const tomorrowStr = businessTomorrow();

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

    // Once per invoice, however many days it stays unpaid; and once per family
    // per run, so two children's invoices are one reminder, not two.
    const { data: overdueInvoices } = await supabase
      .from("invoices")
      .select("*, parents(*), students(*), programs(*), payments(amount)")
      .eq("status", "overdue")
      .lte("due_date", cutoffStr)
      .is("reminded_at", null)
      .order("due_date");

    const template = await getTemplate("payment_reminder");

    const byParent = new Map<string, any[]>();
    for (const invoice of overdueInvoices || []) {
      const list = byParent.get(invoice.parent_id) ?? [];
      list.push(invoice);
      byParent.set(invoice.parent_id, list);
    }

    const names = (xs: string[]) => {
      const u = [...new Set(xs.filter(Boolean))];
      return u.length <= 1 ? u[0] ?? "" : `${u.slice(0, -1).join(", ")} and ${u[u.length - 1]}`;
    };
    const owed = (inv: any) =>
      toCents(inv.amount) - (inv.payments || []).reduce((s: number, p: any) => s + toCents(p.amount), 0);

    for (const invoices of byParent.values()) {
      const parent = invoices[0].parents as any;
      if (!parent) continue;
      const totalCents = invoices.reduce((s, inv) => s + owed(inv), 0);

      if (parent.phone) {
        const message = renderTemplate(template, {
          parent_name: parent.first_name,
          student_name: names(invoices.map((i) => i.students?.first_name)),
          program_name: names(invoices.map((i) => i.programs?.name)),
          month: names(invoices.map((i) => i.month)),
          amount: `$${(totalCents / 100).toFixed(2)}`,
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
      }

      await emailReminder(supabase, {
        parentId: parent.id,
        lines: invoices.map((inv) => ({
          childName: inv.students?.first_name ?? "",
          programName: inv.programs?.name ?? "",
          month: inv.month,
          cents: owed(inv),
        })),
        dedupeKey: `reminder:${invoices.map((i) => i.id).sort().join(",")}`,
      });

      await supabase
        .from("invoices")
        .update({ reminded_at: new Date().toISOString() })
        .in(
          "id",
          invoices.map((i) => i.id)
        );

      results.paymentReminders = (results.paymentReminders as number) + 1;
    }
  }

  // Registration emails the website's ping didn't send (a closed tab, a network
  // blip). Each goes at most once, so asking again for sent ones is harmless.
  const { data: recentRegistrations } = await supabase
    .from("registrations")
    .select("id")
    .not("parent_email", "is", null)
    .in("status", ["pending", "confirmed", "waitlisted"])
    .gte("created_at", new Date(Date.now() - 3 * 86_400_000).toISOString());
  for (const r of recentRegistrations || []) await emailRegistration(supabase, r.id);

  // For the nightly health check: a cron that stopped looks just like a quiet day otherwise.
  await supabase.from("config").update({ value: new Date().toISOString() }).eq("key", "cron_last_run");

  return NextResponse.json({
    success: true,
    ...results,
    timestamp: new Date().toISOString(),
  });
}
