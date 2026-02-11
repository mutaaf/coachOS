import * as http from "http";
import type { WhatsAppClient } from "./client";

export function startHealthServer(whatsapp: WhatsAppClient, port: number) {
  const startedAt = new Date().toISOString();

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
        started_at: startedAt,
        timestamp: new Date().toISOString(),
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }

    // Root path also returns health for simpler healthcheck config
    if (req.url === "/" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`Health server listening on 0.0.0.0:${port}`);
  });

  return server;
}
