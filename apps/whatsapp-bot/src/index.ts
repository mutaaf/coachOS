import { WhatsAppClient } from "./client";
import { MessageQueueProcessor } from "./services/message-queue";
import { startHealthServer } from "./health";

async function main() {
  console.log("CoachOS WhatsApp Bot starting...");

  const whatsapp = new WhatsAppClient();
  const processor = new MessageQueueProcessor(whatsapp);

  const port = parseInt(process.env.PORT || "3001", 10);
  startHealthServer(whatsapp, port);

  await whatsapp.initialize();
  processor.start();

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("Shutting down...");
    processor.stop();
    await whatsapp.destroy();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("Shutting down...");
    processor.stop();
    await whatsapp.destroy();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
