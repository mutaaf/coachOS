import type { OpsClient } from "@/lib/supabase/types";
import { sendEmail } from "@/lib/email";
import {
  inviteEmail,
  paymentFailedEmail,
  receiptEmail,
  registrationEmail,
  reminderEmail,
  welcomeEmail,
  type EmailLine,
  type ProgramDetails,
} from "@/lib/email-templates";
import { payLink } from "@/lib/app-url";
import { BUSINESS_TIMEZONE, businessToday } from "@/lib/dates";
import { toCents } from "@/lib/invoice-status";

/**
 * What each money event emails, and to whom. Each function takes the event's
 * own id as its dedupe key, so calling it twice for one event — a redelivered
 * webhook, the card path and the webhook both settling — sends one email.
 *
 * Families without an email on file are skipped silently; the Outbox and the
 * payment page still reach them.
 */

/** The name parents know the business by, from Settings. */
async function brand(supabase: OpsClient): Promise<string> {
  const { data } = await supabase.from("config").select("value").eq("key", "business_name").maybeSingle();
  return data?.value?.trim() || "Rising Stars Youth Academy";
}

async function parentFor(supabase: OpsClient, parentId: string) {
  const { data } = await supabase
    .from("parents")
    .select("id, first_name, email, pay_token, autopay_label")
    .eq("id", parentId)
    .maybeSingle();
  return data;
}

function onDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const METHOD_NAMES: Record<string, string> = { cash: "cash", zelle: "Zelle", venmo: "Venmo", stripe: "card" };

/**
 * A receipt for one or more payment rows that arrived together — one autopay
 * charge across two children is one receipt, not two.
 */
export async function emailReceipt(
  supabase: OpsClient,
  opts: { paymentIds: string[]; parentId: string | null; dedupeKey: string; method?: string }
) {
  if (opts.paymentIds.length === 0) return;
  const { data: payments } = await supabase
    .from("payments")
    .select("amount, fee, method, received_at, invoices(parent_id, month, students(first_name), programs(name))")
    .in("id", opts.paymentIds);
  if (!payments || payments.length === 0) return;

  const parentId = opts.parentId ?? (payments[0] as any).invoices?.parent_id;
  if (!parentId) return;
  const parent = await parentFor(supabase, parentId);
  if (!parent?.email) return;

  const lines: EmailLine[] = (payments as any[]).map((p) => ({
    childName: p.invoices?.students?.first_name ?? "",
    programName: p.invoices?.programs?.name ?? "",
    month: p.invoices?.month ?? "",
    cents: toCents(p.amount),
  }));
  const feeCents = (payments as any[]).reduce((s, p) => s + toCents(p.fee ?? 0), 0);
  const method =
    opts.method ??
    (payments[0].method === "stripe" && parent.autopay_label
      ? parent.autopay_label
      : METHOD_NAMES[payments[0].method] ?? payments[0].method);

  const content = receiptEmail({
    brand: await brand(supabase),
    parentName: parent.first_name,
    lines,
    feeCents,
    method,
    receivedOn: onDate(payments[0].received_at),
    payLink: payLink(parent.pay_token),
  });
  await sendEmail(supabase, {
    kind: "receipt",
    dedupeKey: opts.dedupeKey,
    parentId,
    to: parent.email,
    ...content,
  });
}

export async function emailPaymentFailed(
  supabase: OpsClient,
  opts: { parentId: string; childNames: string; owedCents: number; reason: string; dedupeKey: string }
) {
  const parent = await parentFor(supabase, opts.parentId);
  if (!parent?.email) return;
  await sendEmail(supabase, {
    kind: "payment_failed",
    dedupeKey: opts.dedupeKey,
    parentId: parent.id,
    to: parent.email,
    ...paymentFailedEmail({
      brand: await brand(supabase),
      parentName: parent.first_name,
      childNames: opts.childNames,
      owedCents: opts.owedCents,
      reason: opts.reason,
      payLink: payLink(parent.pay_token),
    }),
  });
}

export async function emailInvite(
  supabase: OpsClient,
  opts: { parentId: string; childNames: string; dedupeKey: string }
) {
  const parent = await parentFor(supabase, opts.parentId);
  if (!parent?.email) return;
  await sendEmail(supabase, {
    kind: "invite",
    dedupeKey: opts.dedupeKey,
    parentId: parent.id,
    to: parent.email,
    ...inviteEmail({ brand: await brand(supabase), parentName: parent.first_name, childNames: opts.childNames, payLink: payLink(parent.pay_token) }),
  });
}

export async function emailReminder(
  supabase: OpsClient,
  opts: { parentId: string; lines: EmailLine[]; dedupeKey: string }
) {
  const parent = await parentFor(supabase, opts.parentId);
  if (!parent?.email) return;
  await sendEmail(supabase, {
    kind: "reminder",
    dedupeKey: opts.dedupeKey,
    parentId: parent.id,
    to: parent.email,
    ...reminderEmail({ brand: await brand(supabase), parentName: parent.first_name, lines: opts.lines, payLink: payLink(parent.pay_token) }),
  });
}

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

function clock(t: string) {
  const [h, m] = t.split(":").map(Number);
  const hour = ((h + 11) % 12) + 1;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

const half = (t: string) => (Number(t.split(":")[0]) >= 12 ? "PM" : "AM");

/** "Tuesdays, 3:30–4:30 PM at Field B"; "11 AM–12 PM" when it crosses noon. */
export function scheduleText(t: { day_of_week: number; start_time: string; end_time: string; location: string | null }) {
  const start = half(t.start_time) === half(t.end_time) ? clock(t.start_time) : `${clock(t.start_time)} ${half(t.start_time)}`;
  return `${DAYS[t.day_of_week]}, ${start}–${clock(t.end_time)} ${half(t.end_time)}${t.location ? ` at ${t.location}` : ""}`;
}

/** What a family needs to know about a program, for the welcome emails. */
export async function programDetails(supabase: OpsClient, programId: string): Promise<ProgramDetails | null> {
  const [{ data: program }, { data: templates }, { data: next }] = await Promise.all([
    supabase
      .from("programs")
      .select("name, monthly_fee, whatsapp_group_url, location, schools(name)")
      .eq("id", programId)
      .maybeSingle(),
    supabase.from("schedule_templates").select("day_of_week, start_time, end_time, location").eq("program_id", programId),
    supabase
      .from("sessions")
      .select("date")
      .eq("program_id", programId)
      .eq("status", "scheduled")
      .gte("date", businessToday())
      .order("date")
      .limit(1),
  ]);
  if (!program) return null;
  const first = next?.[0]?.date as string | undefined;
  return {
    programName: program.name,
    schoolName: (program as any).schools?.name ?? null,
    schedule: (templates || []).map((t: any) => scheduleText({ ...t, location: t.location ?? program.location })).join("; ") || null,
    firstPractice: first
      ? new Date(`${first}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
      : null,
    monthlyFeeCents: program.monthly_fee != null ? toCents(program.monthly_fee) : null,
    whatsappUrl: program.whatsapp_group_url ?? null,
  };
}

/**
 * Right after a parent signs up — from CoachOS's /join page or the website.
 * Keyed on the registration, so the page, the website's ping and the daily
 * sweep can all ask and it goes once.
 */
export async function emailRegistration(supabase: OpsClient, registrationId: string) {
  const { data: reg } = await supabase
    .from("registrations")
    .select("id, program_id, status, waitlist_position, child_first_name, parent_first_name, parent_email, parent_id")
    .eq("id", registrationId)
    .maybeSingle();
  if (!reg?.parent_email) return "no_address" as const;
  if (!["confirmed", "pending", "waitlisted"].includes(reg.status)) return "skipped" as const;
  const program = await programDetails(supabase, reg.program_id);
  if (!program) return "skipped" as const;
  return sendEmail(supabase, {
    kind: "registration",
    dedupeKey: `registration:${reg.id}`,
    parentId: reg.parent_id,
    to: reg.parent_email,
    ...registrationEmail({
      ...program,
      // The group is for families with a place, not the waitlist.
      whatsappUrl: reg.status === "waitlisted" ? null : program.whatsappUrl,
      brand: await brand(supabase),
      parentName: reg.parent_first_name,
      childName: reg.child_first_name,
      status: reg.status === "waitlisted" ? "waitlisted" : "confirmed",
      waitlistPosition: reg.waitlist_position,
    }),
  });
}

/** When a child goes on a roster: first practice, group chat, payment page. */
export async function emailWelcome(
  supabase: OpsClient,
  opts: { enrollmentId: string; parentId: string; childName: string; programId: string }
) {
  const parent = await parentFor(supabase, opts.parentId);
  if (!parent?.email) return "no_address" as const;
  const program = await programDetails(supabase, opts.programId);
  if (!program) return "skipped" as const;
  return sendEmail(supabase, {
    kind: "welcome",
    dedupeKey: `welcome:${opts.enrollmentId}`,
    parentId: parent.id,
    to: parent.email,
    ...welcomeEmail({
      ...program,
      brand: await brand(supabase),
      parentName: parent.first_name,
      childName: opts.childName,
      payLink: payLink(parent.pay_token),
    }),
  });
}
