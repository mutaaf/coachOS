"use server";

import { createAdminSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function createMessageTemplate(formData: FormData) {
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
  const supabase = createAdminSupabase();
  const body = formData.get("body") as string;
  const variables = [...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);

  const { error } = await supabase
    .from("message_templates")
    .update({
      name: formData.get("name") as string,
      category: formData.get("category") as string,
      body,
      variables,
    })
    .eq("id", id);

  if (error) throw error;
  revalidatePath("/messaging");
}

export async function deleteMessageTemplate(id: string) {
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from("message_templates")
    .update({ is_active: false })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/messaging");
}

export async function sendMessage(formData: FormData) {
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

export async function sendBulkMessages(
  recipients: { phone: string; name: string }[],
  message: string,
  templateId?: string
) {
  const supabase = createAdminSupabase();
  const rows = recipients.map((r) => ({
    recipient_phone: r.phone,
    recipient_name: r.name,
    message,
    template_id: templateId || null,
    status: "pending",
    attempts: 0,
    max_attempts: 3,
  }));

  const { error } = await supabase.from("message_queue").insert(rows);
  if (error) throw error;
  revalidatePath("/messaging");
  return { count: rows.length };
}

export async function fetchRecipients(
  mode: "all" | "school" | "program",
  id?: string
): Promise<{ phone: string; name: string }[]> {
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

export async function retryFailedMessage(queueId: string) {
  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from("message_queue")
    .update({
      status: "pending",
      next_attempt_at: new Date().toISOString(),
    })
    .eq("id", queueId);

  if (error) throw error;
  revalidatePath("/messaging");
}
