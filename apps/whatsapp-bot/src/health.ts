import * as http from "http";
import type { WhatsAppClient } from "./client";

export function startHealthServer(whatsapp: WhatsAppClient, port: number) {
  const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/health" && req.method === "GET") {
      const isReady = whatsapp.getIsReady();
      const body = JSON.stringify({
        status: isReady ? "connected" : "running",
        whatsapp_ready: isReady,
        timestamp: new Date().toISOString(),
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(port, () => {
    console.log(`Health server listening on port ${port}`);
  });

  return server;
}
