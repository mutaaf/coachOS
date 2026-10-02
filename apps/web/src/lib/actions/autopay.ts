"use server";

import { revalidatePath } from "next/cache";
import { renderTemplate } from "shared";
import { createAdminSupabase } from "@/lib/supabase/server";
import { payLink } from "@/lib/app-url";
import { businessToday } from "@/lib/dates";
import { emailInvite } from "@/lib/parent-emails";

/**
 * Families with a child on an active roster who are not on autopay yet, and
 * can be messaged. The same list the dashboard counts, so the number on the
 * button is the number of messages sent.
 */
async function familiesToInvite(supabase: ReturnType<typeof createAdminSupabase>) {
  const { data } = await supabase
    .from("parents")
    .select(
      "id, first_name, last_name, phone, pay_token, autopay_status, student_parents(students(first_name, enrollments(status)))"
    )
    .neq("autopay_status", "active");

  return (data || [])
    .map((p: any) => ({
      ...p,
      children: (p.student_parents || [])
        .map((sp: any) => sp.students)
        .filter((s: any) => s && (s.enrollments || []).some((e: any) => e.status === "active"))
        .map((s: any) => s.first_name as string),
    }))
    .filter((p) => p.phone && p.children.length > 0);
}

export async function countFamiliesToInvite() {
  return (await familiesToInvite(createAdminSupabase())).length;
}

/**
 * Message each family their own payment link, once. Replaces the monthly post
 * in every session's group: after this, the families on autopay never need
 * reminding again.
 */
export async function inviteFamiliesToAutopay() {
  const supabase = createAdminSupabase();
  const families = await familiesToInvite(supabase);
  if (families.length === 0) return { error: "Every family with a child enrolled is already on autopay." };

  const { data: template } = await supabase
    .from("message_templates")
    .select("body")
    .eq("name", "autopay_invite")
    .eq("is_active", true)
    .maybeSingle();
  if (!template) return { error: "The autopay_invite message template is missing or turned off." };

  const rows = families.map((p) => {
    const names: string[] = p.children;
    const studentNames =
      names.length <= 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return {
      recipient_phone: p.phone,
      recipient_name: `${p.first_name} ${p.last_name}`,
      message: renderTemplate(template.body, {
        parent_name: p.first_name,
        student_names: studentNames,
        pay_link: payLink(p.pay_token),
      }),
      status: "pending",
      attempts: 0,
      max_attempts: 3,
    };
  });

  const { error } = await supabase.from("message_queue").insert(rows);
  if (error) return { error: error.message };

  // Families with an email get it there too — once a day at most, however many
  // times the button is pressed.
  const today = businessToday();
  for (const p of families) {
    const names: string[] = p.children;
    await emailInvite(supabase, {
      parentId: p.id,
      childNames: names.length <= 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`,
      dedupeKey: `invite:${p.id}:${today}`,
    });
  }

  revalidatePath("/messaging");
  revalidatePath("/payments");
  return { success: true, queued: rows.length };
}
