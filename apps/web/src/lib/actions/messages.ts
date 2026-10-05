"use server";

import { signedIn, NOT_SIGNED_IN, requireSignedIn } from "@/lib/auth-guard";
import { createAdminSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { renderTemplate } from "shared";
import { quietHoursMessage } from "@/lib/quiet-hours";

/**
 * Templates the app sends on its own, found by name. Renaming or deleting one
 * would silently stop that message going out, so their names are fixed and
 * they can be reworded but not removed.
 */
const SYSTEM_TEMPLATES = new Set([
  "practice_reminder_day_before",
  "practice_reminder_morning",
  "payment_reminder",
  "welcome_message",
  "session_cancelled",
  "payment_received",
  "autopay_invite",
  "autopay_failed",
]);

export async function createMessageTemplate(formData: FormData) {
  await requireSignedIn();
  const supabase = createAdminSupabase();
  const body = formData.get("body") as string;
  const variables = [...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);

  const { error } = await supabase.from("message_templates").insert({
    name: formData.get("name") as string,
    category: formData.get("category") as string,
    body,
    variables,
  });

  if (error) throw error;
  revalidatePath("/messaging");
}

export async function updateMessageTemplate(id: string, formData: FormData) {
  await requireSignedIn();
  const supabase = createAdminSupabase();
  const body = formData.get("body") as string;
  const variables = [...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);

  const { data: current } = await supabase.from("message_templates").select("name").eq("id", id).maybeSingle();
  const name = SYSTEM_TEMPLATES.has(current?.name ?? "") ? current!.name : (formData.get("name") as string);

  const { error } = await supabase
    .from("message_templates")
    .update({
      name,
      category: formData.get("category") as string,
      body,
      variables,
    })
    .eq("id", id);

  if (error) throw error;
  revalidatePath("/messaging");
}

export async function deleteMessageTemplate(id: string) {
  await requireSignedIn();
  const supabase = createAdminSupabase();
  const { data: current } = await supabase.from("message_templates").select("name").eq("id", id).maybeSingle();
  if (SYSTEM_TEMPLATES.has(current?.name ?? "")) {
    throw new Error("This message is sent automatically, so it can be reworded but not deleted.");
  }
  const { error } = await supabase
    .from("message_templates")
    .update({ is_active: false })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/messaging");
}

export async function sendMessage(formData: FormData) {
  await requireSignedIn();
  const supabase = createAdminSupabase();
  const { error } = await supabase.from("message_queue").insert({
    recipient_phone: formData.get("recipient_phone") as string,
    recipient_name: formData.get("recipient_name") as string || null,
    message: formData.get("message") as string,
    template_id: formData.get("template_id") as string || null,
    status: "pending",
    attempts: 0,
    max_attempts: 3,
  });

  if (error) throw error;
  revalidatePath("/messaging");
}

/**
 * Queue one message per recipient in the Outbox.
 *
 * `purpose` decides who may get it (enforced in the database,
 * 20261006000130_messaging_consent.sql and 20261007000100_promotional_texts.sql):
 * "operational" — about the child's program — goes to every parent who hasn't
 * said STOP; "promotional" only to parents who agreed to promotional texts
 * (sms_promotional — agreeing to program texts isn't enough). Those who can't
 * get it are filed as skipped with the reason, and counted in `skipped`.
 *
 * A promotion is refused outright outside Texas quiet hours (§301.051).
 */
export async function sendBulkMessages(
  recipients: { phone: string; name: string }[],
  message: string,
  templateId?: string,
  purpose: "operational" | "promotional" = "operational"
) {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const supabase = createAdminSupabase();

  if (purpose === "promotional") {
    const quiet = quietHoursMessage();
    if (quiet) return { error: quiet };
  }

  // Compose knows each recipient's name and nothing else, so {{parent_name}}
  // is filled in and anything else is refused — a parent must never receive a
  // raw "{{student_name}}".
  const unknown = [...new Set([...message.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].filter(
    (v) => v !== "parent_name"
  );
  if (unknown.length) {
    return {
      error: `A message to a group can only fill in {{parent_name}}. Remove ${unknown.map((v) => `{{${v}}}`).join(", ")} or write it out.`,
    };
  }

  const rows = recipients.map((r) => ({
    recipient_phone: r.phone,
    recipient_name: r.name,
    message: renderTemplate(message, { parent_name: (r.name || "").trim().split(/\s+/)[0] || "there" }),
    template_id: templateId || null,
    status: "pending",
    attempts: 0,
    max_attempts: 3,
    purpose: purpose === "promotional" ? "promotional" : "operational",
  }));

  const { data: queued, error } = await supabase.from("message_queue").insert(rows).select("status");
  if (error) throw error;
  revalidatePath("/messaging");
  return { count: rows.length, skipped: (queued ?? []).filter((r) => r.status === "skipped").length };
}

export async function fetchRecipients(
  mode: "all" | "school" | "program",
  id?: string
): Promise<{ phone: string; name: string }[]> {
  await requireSignedIn();
  const supabase = createAdminSupabase();

  if (mode === "all") {
    const { data } = await supabase
      .from("parents")
      .select("id, first_name, last_name, phone");
    return (data || []).map((p) => ({
      phone: p.phone,
      name: `${p.first_name} ${p.last_name}`,
    }));
  }

  let parentIds: string[] = [];

  if (mode === "school" && id) {
    const { data: progs } = await supabase
      .from("programs")
      .select("id")
      .eq("school_id", id);
    const progIds = (progs || []).map((p: any) => p.id);
    if (progIds.length === 0) return [];
    const { data: enrollments } = await supabase
      .from("enrollments")
      .select("student_id")
      .in("program_id", progIds)
      .eq("status", "active");
    const studentIds = [
      ...new Set((enrollments || []).map((e: any) => e.student_id)),
    ];
    if (studentIds.length === 0) return [];
    const { data: links } = await supabase
      .from("student_parents")
      .select("parent_id")
      .in("student_id", studentIds);
    parentIds = [
      ...new Set((links || []).map((l: any) => l.parent_id)),
    ];
  }

  if (mode === "program" && id) {
    const { data: enrollments } = await supabase
      .from("enrollments")
      .select("student_id")
      .eq("program_id", id)
      .eq("status", "active");
    const studentIds = [
      ...new Set((enrollments || []).map((e: any) => e.student_id)),
    ];
    if (studentIds.length === 0) return [];
    const { data: links } = await supabase
      .from("student_parents")
      .select("parent_id")
      .in("student_id", studentIds);
    parentIds = [
      ...new Set((links || []).map((l: any) => l.parent_id)),
    ];
  }

  if (parentIds.length > 0) {
    const { data: parents } = await supabase
      .from("parents")
      .select("id, first_name, last_name, phone")
      .in("id", parentIds);
    return (parents || []).map((p) => ({
      phone: p.phone,
      name: `${p.first_name} ${p.last_name}`,
    }));
  }

  return [];
}
