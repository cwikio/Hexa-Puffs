/**
 * Guardian MCP Server - Entry Point
 * Supports both stdio and HTTP/SSE transports
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "./server.js";
import { createServer as createHttpServer } from "node:http";
import { verifyConnection, getOllamaHost, getModelName } from "./ollama/client.js";

const TRANSPORT = process.env.TRANSPORT || "stdio";
const PORT = parseInt(process.env.PORT || "3000", 10);

async function main() {
  // Verify Ollama connection on startup (warn but don't fail for stdio)
  try {
    await verifyConnection();
    console.error(`Connected to Ollama at ${getOllamaHost()}`);
    console.error(`Using model: ${getModelName()}`);
  } catch (error) {
    console.error(
      `Warning: ${error instanceof Error ? error.message : "Cannot connect to Ollama"}`
    );
    console.error("Scans will fail until Ollama is running with the guardian model.");
  }

  const server = createServer();

  if (TRANSPORT === "http" || TRANSPORT === "sse") {
    // HTTP/SSE transport - track active transports by session
    const transports = new Map<string, SSEServerTransport>();

    const httpServer = createHttpServer(async (req, res) => {
      console.error(`${req.method} ${req.url}`);

      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.url === "/sse" && req.method === "GET") {
        const transport = new SSEServerTransport("/messages", res);
        const sessionId = transport.sessionId;
        transports.set(sessionId, transport);
        console.error(`SSE connection established - sessionId: ${sessionId}`);

        // Clean up on close
        res.on("close", () => {
          console.error(`SSE connection closed - sessionId: ${sessionId}`);
          transports.delete(sessionId);
        });

        await server.connect(transport);
        return;
      }

      // Handle POST messages for MCP - URL pattern: /messages?sessionId=xxx
      const parsedUrl = new URL(req.url || "/", `http://localhost:${PORT}`);
      if (parsedUrl.pathname === "/messages" && req.method === "POST") {
        const sessionId = parsedUrl.searchParams.get("sessionId");
        console.error(`POST /messages - sessionId: ${sessionId}, active sessions: ${Array.from(transports.keys()).join(", ")}`);

        if (!sessionId || !transports.has(sessionId)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid or missing session ID" }));
          return;
        }

        const transport = transports.get(sessionId)!;
        await transport.handlePostMessage(req, res);
        return;
      }

      if (req.url === "/health") {
        // Check Ollama connection for health endpoint
        let ollamaOk = false;
        try {
          await verifyConnection();
          ollamaOk = true;
        } catch {
          ollamaOk = false;
        }

        res.writeHead(ollamaOk ? 200 : 503, {
          "Content-Type": "application/json",
        });
        res.end(
          JSON.stringify({
            status: ollamaOk ? "healthy" : "degraded",
            transport: "http",
            ollama: ollamaOk ? "connected" : "disconnected",
            model: getModelName(),
          })
        );
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    httpServer.listen(PORT, () => {
      console.error(`Guardian MCP server listening on port ${PORT}`);
      console.error(`SSE endpoint: http://localhost:${PORT}/sse`);
      console.error(`Health check: http://localhost:${PORT}/health`);
    });
  } else {
    // Default: stdio transport for Claude Desktop
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Guardian MCP server running on stdio");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
