/**
 * Guardian MCP Server - Entry Point
 * Supports both stdio and HTTP/SSE transports
 */

import { config as dotenvConfig } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env before any other imports that read process.env
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenvConfig({ path: resolve(__dirname, "../.env") });

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "./server.js";
import { createServer as createHttpServer } from "node:http";
import { verifyConnection, getHost, getModelName, getProviderName } from "./provider.js";
import { Logger } from "@mcp/shared/Utils/logger.js";

const logger = new Logger('guardian');
const TRANSPORT = process.env.TRANSPORT || "stdio";
const PORT = parseInt(process.env.PORT || "3000", 10);

async function main() {
  // Verify provider connection on startup (warn but don't fail for stdio)
  const provider = getProviderName();
  try {
    await verifyConnection();
    logger.info(`Connected to ${provider} at ${getHost()}`);
    logger.info(`Using model: ${getModelName()}`);
  } catch (error) {
    logger.warn(error instanceof Error ? error.message : `Cannot connect to ${provider}`);
    logger.warn(`Scans will fail until ${provider} is available.`);
  }

  const server = createServer();

  if (TRANSPORT === "http" || TRANSPORT === "sse") {
    // HTTP/SSE transport - track active transports by session
    const transports = new Map<string, SSEServerTransport>();

    const httpServer = createHttpServer(async (req, res) => {
      logger.debug(`${req.method} ${req.url}`);

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
        logger.info(`SSE connection established`, { sessionId });

        // Clean up on close
        res.on("close", () => {
          logger.info(`SSE connection closed`, { sessionId });
          transports.delete(sessionId);
        });

        await server.connect(transport);
        return;
      }

      // Handle POST messages for MCP - URL pattern: /messages?sessionId=xxx
      const parsedUrl = new URL(req.url || "/", `http://localhost:${PORT}`);
      if (parsedUrl.pathname === "/messages" && req.method === "POST") {
        const sessionId = parsedUrl.searchParams.get("sessionId");
        logger.debug(`POST /messages`, { sessionId, activeSessions: Array.from(transports.keys()) });

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
        let providerOk = false;
        try {
          await verifyConnection();
          providerOk = true;
        } catch {
          providerOk = false;
        }

        res.writeHead(providerOk ? 200 : 503, {
          "Content-Type": "application/json",
        });
        res.end(
          JSON.stringify({
            status: providerOk ? "healthy" : "degraded",
            transport: "http",
            provider: getProviderName(),
            providerStatus: providerOk ? "connected" : "disconnected",
            model: getModelName(),
          })
        );
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    httpServer.listen(PORT, () => {
      logger.info(`Guardian MCP server listening on port ${PORT}`);
      logger.info(`SSE endpoint: http://localhost:${PORT}/sse`);
      logger.info(`Health check: http://localhost:${PORT}/health`);
    });
  } else {
    // Default: stdio transport for Claude Desktop
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("Guardian MCP server running on stdio");
  }
}

main().catch((error) => {
  logger.error("Fatal error", error);
  process.exit(1);
});
