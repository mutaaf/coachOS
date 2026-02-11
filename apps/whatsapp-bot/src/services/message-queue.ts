import { createClient } from "@supabase/supabase-js";
import { WhatsAppClient } from "../client";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export class MessageQueueProcessor {
  private whatsapp: WhatsAppClient;
  private interval: NodeJS.Timeout | null = null;
  private processing = false;
  private rateLimitMs = 3000; // 1 message per 3 seconds

  constructor(whatsapp: WhatsAppClient) {
    this.whatsapp = whatsapp;
  }

  start(): void {
    console.log("Message queue processor started (polling every 10s)");
    this.interval = setInterval(() => this.processQueue(), 10000);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log("Message queue processor stopped");
  }

  private async processQueue(): Promise<void> {
    if (this.processing || !this.whatsapp.getIsReady()) return;
    this.processing = true;

    try {
      // Load rate limit from config
      const { data: configData } = await supabase
        .from("config")
        .select("value")
        .eq("key", "message_rate_limit_seconds")
        .single();

      if (configData?.value) {
        this.rateLimitMs = Number(configData.value) * 1000;
      }

      // Get pending messages ready to send
      const { data: messages, error } = await supabase
        .from("message_queue")
        .select("*")
        .eq("status", "pending")
        .lte("next_attempt_at", new Date().toISOString())
        .order("created_at", { ascending: true })
        .limit(10);

      if (error || !messages || messages.length === 0) {
        this.processing = false;
        return;
      }

      console.log(`Processing ${messages.length} message(s)...`);

      for (const msg of messages) {
        // Mark as sending
        await supabase
          .from("message_queue")
          .update({ status: "sending", attempts: msg.attempts + 1 })
          .eq("id", msg.id);

        try {
          const whatsappMsgId = await this.whatsapp.sendMessage(
            msg.recipient_phone,
            msg.message
          );

          // Mark as sent
          await supabase
            .from("message_queue")
            .update({ status: "sent" })
            .eq("id", msg.id);

          // Log to message_log
          await supabase.from("message_log").insert({
            queue_id: msg.id,
            recipient_phone: msg.recipient_phone,
            recipient_name: msg.recipient_name,
            message: msg.message,
            status: "sent",
            whatsapp_message_id: whatsappMsgId,
          });

          console.log(`Sent to ${msg.recipient_name || msg.recipient_phone}`);
        } catch (err: any) {
          const attempts = msg.attempts + 1;
          const maxAttempts = msg.max_attempts || 3;

          if (attempts >= maxAttempts) {
            // Max retries reached
            await supabase
              .from("message_queue")
              .update({
                status: "failed",
                error: err.message || "Unknown error",
              })
              .eq("id", msg.id);

            // Log failure
            await supabase.from("message_log").insert({
              queue_id: msg.id,
              recipient_phone: msg.recipient_phone,
              recipient_name: msg.recipient_name,
              message: msg.message,
              status: "failed",
              error: err.message || "Unknown error",
            });

            console.error(`Failed permanently: ${msg.recipient_phone} - ${err.message}`);
          } else {
            // Exponential backoff: 30s, 90s, 270s...
            const backoffSeconds = 30 * Math.pow(3, attempts - 1);
            const nextAttempt = new Date();
            nextAttempt.setSeconds(nextAttempt.getSeconds() + backoffSeconds);

            await supabase
              .from("message_queue")
              .update({
                status: "pending",
                error: err.message || "Unknown error",
                next_attempt_at: nextAttempt.toISOString(),
              })
              .eq("id", msg.id);

            console.warn(`Retry scheduled for ${msg.recipient_phone} in ${backoffSeconds}s`);
          }
        }

        // Rate limiting
        await new Promise((resolve) => setTimeout(resolve, this.rateLimitMs));
      }
    } catch (err) {
      console.error("Queue processing error:", err);
    } finally {
      this.processing = false;
    }
  }
}
