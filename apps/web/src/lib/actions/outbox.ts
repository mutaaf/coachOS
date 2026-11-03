"use server";

import { revalidatePath } from "next/cache";
import { createAdminSupabase } from "@/lib/supabase/server";
import { signedIn, NOT_SIGNED_IN } from "@/lib/auth-guard";
import { quietHoursMessage } from "@/lib/quiet-hours";

/**
 * The owner has opened a message in WhatsApp or Messages, or decided not to
 * send it.
 *
 * Opening it is taken as sending it — there is no way to know she pressed
 * send in the other app — so every mark can be undone from the outbox.
 */
export async function markOutboxMessage(id: string, how: "whatsapp" | "sms" | "skipped" | "undo") {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const supabase = createAdminSupabase();

  const { data: msg } = await supabase
    .from("message_queue")
    .select("id, recipient_phone, recipient_name, message, status, purpose")
    .eq("id", id)
    .maybeSingle();
  if (!msg) return { error: "That message is no longer in the outbox." };

  // Texas quiet hours (§301.051): a promotion waits until it may go. The
  // database refuses it too (ops.promotion_keeps_quiet_hours).
  if ((how === "whatsapp" || how === "sms") && msg.purpose === "promotional" && msg.status !== "sent") {
    const quiet = quietHoursMessage();
    if (quiet) return { error: quiet };
  }

  if (how === "undo") {
    await supabase.from("message_log").delete().eq("queue_id", id);
    const { error } = await supabase
      .from("message_queue")
      .update({ status: "pending", sent_via: null })
      .eq("id", id);
    if (error) return { error: error.message };
  } else if (how === "skipped") {
    const { error } = await supabase.from("message_queue").update({ status: "skipped" }).eq("id", id);
    if (error) return { error: error.message };
  } else {
    // A second tap — re-sending from WhatsApp after a mis-tap — updates how it
    // went rather than logging it twice.
    const { error } = await supabase
      .from("message_queue")
      .update({ status: "sent", sent_via: how })
      .eq("id", id);
    if (error) return { error: error.message };
    if (msg.status !== "sent") {
      await supabase.from("message_log").insert({
        queue_id: id,
        recipient_phone: msg.recipient_phone,
        recipient_name: msg.recipient_name,
        message: msg.message,
        status: "sent",
      });
    }
  }

  revalidatePath("/messaging");
  return { success: true };
}

/** Clear everything still waiting — for a batch queued by mistake. */
export async function skipAllPending() {
  if (!(await signedIn())) return NOT_SIGNED_IN;
  const { error } = await createAdminSupabase()
    .from("message_queue")
    .update({ status: "skipped" })
    .eq("status", "pending");
  if (error) return { error: error.message };
  revalidatePath("/messaging");
  return { success: true };
}
