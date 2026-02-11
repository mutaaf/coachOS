import * as http from "http";

// ============================================
// START HTTP HEALTH SERVER IMMEDIATELY
// This MUST run before any other imports that
// could crash (Puppeteer, Supabase, etc.)
// ============================================
console.log("=== Bot process starting ===");
console.log("PORT env:", process.env.PORT);
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("SUPABASE_URL set:", !!process.env.SUPABASE_URL);
console.log("SUPABASE_SERVICE_ROLE_KEY set:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);

const port = parseInt(process.env.PORT || "8080", 10);
let whatsappReady = false;
let botStatus = "starting";

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: whatsappReady ? "connected" : "running",
      whatsapp_ready: whatsappReady,
      bot_status: botStatus,
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.on("error", (err) => {
  console.error("Health server error:", err);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Health server listening on 0.0.0.0:${port}`);
});

// ============================================
// NOW load WhatsApp (can safely fail)
// ============================================
async function startBot() {
  try {
    botStatus = "loading";
    const { WhatsAppClient } = await import("./client");
    const { MessageQueueProcessor } = await import("./services/message-queue");

    console.log("CoachOS WhatsApp Bot starting...");
    const whatsapp = new WhatsAppClient();
    const processor = new MessageQueueProcessor(whatsapp);

    botStatus = "initializing";
    await whatsapp.initialize();

    whatsappReady = true;
    botStatus = "connected";
    console.log("WhatsApp initialized, starting message processor...");
    processor.start();

    // Update ready status when connection changes
    const checkReady = setInterval(() => {
      whatsappReady = whatsapp.getIsReady();
      botStatus = whatsappReady ? "connected" : "reconnecting";
    }, 5000);

    // Graceful shutdown
    const shutdown = async () => {
      console.log("Shutting down...");
      clearInterval(checkReady);
      processor.stop();
      await whatsapp.destroy().catch(() => {});
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (err) {
    console.error("WhatsApp initialization failed:", err);
    botStatus = "error";
    console.log("Health server still running. Retrying in 30s...");
    setTimeout(startBot, 30000);
  }
}

startBot();
