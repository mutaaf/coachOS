import { WhatsAppClient } from "./client";
import { MessageQueueProcessor } from "./services/message-queue";
import { startHealthServer } from "./health";

const whatsapp = new WhatsAppClient();
const processor = new MessageQueueProcessor(whatsapp);

// Start health server FIRST — must be reachable before anything else
const port = parseInt(process.env.PORT || "3001", 10);
startHealthServer(whatsapp, port);

// Initialize WhatsApp in the background — don't crash if it fails
async function initWhatsApp() {
  try {
    console.log("CoachOS WhatsApp Bot starting...");
    await whatsapp.initialize();
    console.log("WhatsApp initialized, starting message processor...");
    processor.start();
  } catch (err) {
    console.error("WhatsApp initialization failed:", err);
    console.log("Health server is still running. Will retry in 30 seconds...");
    setTimeout(initWhatsApp, 30000);
  }
}

initWhatsApp();

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down...");
  processor.stop();
  await whatsapp.destroy().catch(() => {});
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  processor.stop();
  await whatsapp.destroy().catch(() => {});
  process.exit(0);
});
