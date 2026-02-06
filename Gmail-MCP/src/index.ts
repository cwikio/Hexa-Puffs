#!/usr/bin/env node

// Load environment variables first
import { config as dotenvConfig } from "dotenv";
dotenvConfig();

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer as createHttpServer } from "http";
import { initializeServer } from "./server.js";
import { getConfig } from "./config/index.js";
import { allTools } from "./tools/index.js";
import { logger } from "./utils/logger.js";
import { hasValidToken } from "./gmail/auth.js";
import { startPolling, stopPolling } from "./gmail/polling.js";

async function main(): Promise<void> {
  const config = getConfig();

  logger.info("Starting Gmail MCP", {
    transport: config.transport,
    port: config.port,
  });

  // Check for valid token
  if (!hasValidToken()) {
    logger.warn(
      "No Gmail token found. Please run 'npm run setup-oauth' to authenticate."
    );
  }

  const server = await initializeServer();

  if (config.transport === "http" || config.transport === "sse") {
    const httpServer = createHttpServer(async (req, res) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      // Health check
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            hasToken: hasValidToken(),
            toolCount: allTools.length,
          })
        );
        return;
      }

      // List available tools
      if (req.method === "GET" && req.url === "/tools/list") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            tools: allTools.map(({ tool }) => tool),
          })
        );
        return;
      }

      // SSE endpoint
      if (req.method === "GET" && req.url === "/sse") {
        logger.info("SSE connection established");
        const sseTransport = new SSEServerTransport("/message", res);
        await server.connect(sseTransport);
        return;
      }

      // Message endpoint for SSE
      if (req.method === "POST" && req.url === "/message") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true }));
        return;
      }

      // Direct tool call endpoint
      if (req.method === "POST" && req.url === "/tools/call") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", async () => {
          try {
            const { name, arguments: args } = JSON.parse(body);

            const toolEntry = allTools.find(({ tool }) => tool.name === name);
            if (!toolEntry) {
              res.writeHead(404, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify({
                        success: false,
                        error: `Unknown tool: ${name}`,
                      }),
                    },
                  ],
                })
              );
              return;
            }

            const output = await toolEntry.handler(args ?? {});
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                content: [{ type: "text", text: JSON.stringify(output) }],
              })
            );
          } catch (error) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      success: false,
                      error:
                        error instanceof Error ? error.message : "Unknown error",
                    }),
                  },
                ],
              })
            );
          }
        });
        return;
      }

      // Not found
      res.writeHead(404);
      res.end("Not found");
    });

    httpServer.listen(config.port, () => {
      logger.info(`Gmail MCP running on http://localhost:${config.port}`);
      logger.info(`SSE endpoint: http://localhost:${config.port}/sse`);
      logger.info(`Health check: http://localhost:${config.port}/health`);
      logger.info(`Tools list: GET http://localhost:${config.port}/tools/list`);
      logger.info(`Tools call: POST http://localhost:${config.port}/tools/call`);
    });

    // Start polling if enabled
    if (config.polling.enabled && hasValidToken()) {
      logger.info("Starting email polling", {
        intervalMs: config.polling.intervalMs,
      });
      startPolling(config.polling.intervalMs);
    }

    // Graceful shutdown
    const shutdown = () => {
      logger.info("Shutting down...");
      stopPolling();
      httpServer.close(() => {
        logger.info("Server closed");
        process.exit(0);
      });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } else {
    // stdio transport
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
    logger.info("Gmail MCP running on stdio");

    // Start polling if enabled
    if (config.polling.enabled && hasValidToken()) {
      logger.info("Starting email polling", {
        intervalMs: config.polling.intervalMs,
      });
      startPolling(config.polling.intervalMs);
    }
  }
}

main().catch((error) => {
  logger.error("Fatal error", { error });
  process.exit(1);
});
