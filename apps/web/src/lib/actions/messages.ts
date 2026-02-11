"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function createMessageTemplate(formData: FormData) {
  const supabase = createServerSupabase();
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
  const supabase = createServerSupabase();
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
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from("message_templates")
    .update({ is_active: false })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/messaging");
}

export async function sendMessage(formData: FormData) {
  const supabase = createServerSupabase();
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
  const supabase = createServerSupabase();
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

export async function retryFailedMessage(queueId: string) {
  const supabase = createServerSupabase();
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
