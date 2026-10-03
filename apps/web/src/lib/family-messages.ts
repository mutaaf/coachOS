import type { OpsClient } from "@/lib/supabase/types";
import { renderTemplate } from "shared";
import { businessToday, formatDateOnly } from "@/lib/dates";
import { emailRegistration, emailSeat, programDetails } from "@/lib/parent-emails";

/**
 * The messages the app writes for the Boss to send from her phone, each in
 * the Outbox once per event however many times it is asked: a double tap, the
 * website's ping and the daily sweep all landing on the same sign-up.
 *
 * Not "use server": every export of such a module is a public endpoint, and
 * these run from the signed-out /join page.
 */

/**
 * Templates the app sends on its own, found by name. Renaming or deleting one
 * would silently stop that message going out, so their names are fixed and
 * they can be reworded but not removed. Only list one that something sends.
 */
export const SYSTEM_TEMPLATES = new Set([
  "practice_reminder_day_before",
  "payment_reminder",
  "autopay_invite",
  "autopay_failed",
  "session_cancelled",
  "welcome_message",
  "registration_received",
  "waitlist_joined",
  "waitlist_seat",
]);

/**
 * Write a template out for one family and put it in the Outbox. Returns
 * whether a new message was queued: no phone, no template, or already queued
 * for this event are all false.
 */
export async function queueTemplate(
  supabase: OpsClient,
  opts: {
    template: string;
    phone: string | null | undefined;
    name: string;
    vars: Record<string, string | number>;
    dedupeKey: string;
  }
): Promise<boolean> {
  if (!opts.phone?.trim()) return false;
  const { data: template } = await supabase
    .from("message_templates")
    .select("id, body")
    .eq("name", opts.template)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!template) return false;

  const { data, error } = await supabase
    .from("message_queue")
    .upsert(
      {
        recipient_phone: opts.phone,
        recipient_name: opts.name,
        message: renderTemplate(template.body, opts.vars),
        template_id: template.id,
        status: "pending",
        attempts: 0,
        max_attempts: 3,
        dedupe_key: opts.dedupeKey,
      },
      { onConflict: "dedupe_key", ignoreDuplicates: true }
    )
    .select("id");
  if (error) {
    console.error("Couldn't queue message", opts.dedupeKey, error);
    return false;
  }
  return (data ?? []).length > 0;
}

/**
 * A practice is off: one message to each family with a child on the roster —
 * one per family, not per child. A practice already past is being recorded,
 * not announced, so nobody is told.
 */
export async function queueSessionCancelled(supabase: OpsClient, sessionId: string): Promise<number> {
  const { data: session } = await supabase
    .from("sessions")
    .select("id, date, program_id, cancel_reason, programs(name)")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.date < businessToday()) return 0;

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("students(student_parents(parents(id, first_name, last_name, phone)))")
    .eq("program_id", session.program_id)
    .eq("status", "active");

  const parents = new Map<string, { id: string; first_name: string; last_name: string; phone: string | null }>();
  for (const e of (enrollments ?? []) as any[]) {
    for (const link of e.students?.student_parents ?? []) {
      if (link.parents) parents.set(link.parents.id, link.parents);
    }
  }

  const date = formatDateOnly(session.date, { weekday: "long", month: "long", day: "numeric" });
  let queued = 0;
  for (const parent of parents.values()) {
    const sent = await queueTemplate(supabase, {
      template: "session_cancelled",
      phone: parent.phone,
      name: `${parent.first_name} ${parent.last_name}`.trim(),
      vars: {
        parent_name: parent.first_name,
        program_name: (session as any).programs?.name ?? "",
        date,
        reason: session.cancel_reason ? ` (${session.cancel_reason})` : "",
      },
      dedupeKey: `cancelled:${session.id}:${parent.id}`,
    });
    if (sent) queued++;
  }
  return queued;
}

async function registrationFor(supabase: OpsClient, registrationId: string) {
  const { data } = await supabase
    .from("registrations")
    .select(
      "id, status, waitlist_position, enrollment_id, child_first_name, parent_first_name, parent_last_name, parent_phone, programs(name, schools(name))"
    )
    .eq("id", registrationId)
    .maybeSingle();
  return data as any;
}

/**
 * Right after a family signs up: the email, and a message in the Outbox — that
 * they're in, or their place on the waitlist.
 */
export async function welcomeRegistration(supabase: OpsClient, registrationId: string) {
  await emailRegistration(supabase, registrationId);
  const reg = await registrationFor(supabase, registrationId);
  if (!reg || !["confirmed", "pending", "waitlisted"].includes(reg.status)) return;
  // Already on the roster: the welcome message has said it.
  if (reg.enrollment_id) return;
  const waitlisted = reg.status === "waitlisted";
  await queueTemplate(supabase, {
    template: waitlisted ? "waitlist_joined" : "registration_received",
    phone: reg.parent_phone,
    name: `${reg.parent_first_name} ${reg.parent_last_name}`.trim(),
    vars: {
      parent_name: reg.parent_first_name,
      student_name: reg.child_first_name,
      program_name: reg.programs?.name ?? "",
      school_name: reg.programs?.schools?.name ?? "",
      position: reg.waitlist_position ?? "",
    },
    dedupeKey: `registration:${reg.id}`,
  });
}

/** A waiting family has been given the place that opened: tell them, both ways. */
export async function tellSeatOpened(supabase: OpsClient, registrationId: string) {
  await emailSeat(supabase, registrationId);
  const reg = await registrationFor(supabase, registrationId);
  if (!reg) return;
  await queueTemplate(supabase, {
    template: "waitlist_seat",
    phone: reg.parent_phone,
    name: `${reg.parent_first_name} ${reg.parent_last_name}`.trim(),
    vars: {
      parent_name: reg.parent_first_name,
      student_name: reg.child_first_name,
      program_name: reg.programs?.name ?? "",
      school_name: reg.programs?.schools?.name ?? "",
    },
    dedupeKey: `seat:${reg.id}`,
  });
}

/**
 * A child who signed up is on the roster: the welcome message, unless the Boss
 * turned Welcome Messages off in Settings.
 */
export async function queueWelcome(
  supabase: OpsClient,
  opts: { enrollmentId: string; parentId: string; childName: string; programId: string }
) {
  const { data: setting } = await supabase
    .from("config")
    .select("value")
    .eq("key", "welcome_message_enabled")
    .maybeSingle();
  if (setting?.value !== "true") return;

  const [{ data: parent }, program] = await Promise.all([
    supabase.from("parents").select("first_name, last_name, phone").eq("id", opts.parentId).maybeSingle(),
    programDetails(supabase, opts.programId),
  ]);
  if (!parent || !program) return;
  await queueTemplate(supabase, {
    template: "welcome_message",
    phone: parent.phone,
    name: `${parent.first_name} ${parent.last_name}`.trim(),
    vars: {
      parent_name: parent.first_name,
      student_name: opts.childName,
      program_name: program.programName,
      school_name: program.schoolName ?? "",
      schedule: program.schedule ?? "on the schedule we'll send you",
    },
    dedupeKey: `welcome:${opts.enrollmentId}`,
  });
}
