import { Client, LocalAuth } from "whatsapp-web.js";
import * as qrcode from "qrcode";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export class WhatsAppClient {
  private client: Client;
  private isReady = false;

  constructor() {
    this.client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      },
    });
  }

  async initialize(): Promise<void> {
    // Ensure whatsapp_state row exists (seed may not have run)
    const { data: existing } = await supabase
      .from("whatsapp_state")
      .select("id")
      .limit(1)
      .maybeSingle();
    if (!existing) {
      await supabase.from("whatsapp_state").insert({ status: "disconnected" });
      console.log("Created whatsapp_state row");
    }

    this.client.on("qr", async (qr) => {
      console.log("QR code received");
      try {
        const qrBase64 = await qrcode.toDataURL(qr);
        const base64Data = qrBase64.replace(/^data:image\/png;base64,/, "");

        await supabase
          .from("whatsapp_state")
          .update({
            status: "qr_ready",
            qr_code: base64Data,
            updated_at: new Date().toISOString(),
          })
          .not("id", "is", null);

        console.log("QR code saved to database");
      } catch (err) {
        console.error("Failed to save QR code:", err);
      }
    });

    this.client.on("ready", async () => {
      console.log("WhatsApp client ready!");
      this.isReady = true;

      const info = this.client.info;
      await supabase
        .from("whatsapp_state")
        .update({
          status: "connected",
          qr_code: null,
          phone_number: info?.wid?.user || null,
          last_connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .not("id", "is", null);
    });

    this.client.on("disconnected", async (reason) => {
      console.log("WhatsApp disconnected:", reason);
      this.isReady = false;

      await supabase
        .from("whatsapp_state")
        .update({
          status: "disconnected",
          updated_at: new Date().toISOString(),
        })
        .not("id", "is", null);

      // Auto-reconnect after 10 seconds
      setTimeout(() => {
        console.log("Attempting reconnection...");
        this.client.initialize().catch(console.error);
      }, 10000);
    });

    this.client.on("auth_failure", async (msg) => {
      console.error("Auth failure:", msg);
      await supabase
        .from("whatsapp_state")
        .update({
          status: "disconnected",
          updated_at: new Date().toISOString(),
        })
        .not("id", "is", null);
    });

    await supabase
      .from("whatsapp_state")
      .update({
        status: "connecting",
        updated_at: new Date().toISOString(),
      })
      .not("id", "is", null);

    await this.client.initialize();
  }

  async sendMessage(phone: string, message: string): Promise<string | null> {
    if (!this.isReady) {
      throw new Error("WhatsApp client not ready");
    }

    // Format phone number for WhatsApp (country code + number)
    let formattedPhone = phone.replace(/\D/g, "");
    if (formattedPhone.length === 10) {
      formattedPhone = "1" + formattedPhone; // US default
    }
    const chatId = `${formattedPhone}@c.us`;

    try {
      const result = await this.client.sendMessage(chatId, message);
      return result.id?.id || null;
    } catch (err) {
      console.error("Send message error:", err);
      throw err;
    }
  }

  getIsReady(): boolean {
    return this.isReady;
  }

  async destroy(): Promise<void> {
    await this.client.destroy();
  }
}
