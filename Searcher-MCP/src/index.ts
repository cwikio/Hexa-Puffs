/**
 * Searcher MCP Server - Entry Point
 * Supports both stdio and HTTP/SSE transports
 */

import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "../.env");
// Only load .env if it exists — dotenv v17 writes to stdout otherwise
if (existsSync(envPath)) {
  dotenvConfig({ path: envPath, quiet: true });
}

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "./server.js";
import { createServer as createHttpServer } from "node:http";
import { getConfig } from "./utils/config.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { Logger } from "@mcp/shared/Utils/logger.js";

const logger = new Logger('searcher');
import {
  webSearchSchema,
  handleWebSearch,
  newsSearchSchema,
  handleNewsSearch,
  imageSearchSchema,
  handleImageSearch,
} from "./tools/index.js";

const TRANSPORT = process.env.TRANSPORT || "stdio";
const PORT = parseInt(process.env.PORT || "8007", 10);
const ANNABELLE_TOKEN = process.env.ANNABELLE_TOKEN;

async function main() {
  // Validate config (will throw if BRAVE_API_KEY is missing)
  const config = getConfig();

  const server = createServer();

  if (TRANSPORT === "http" || TRANSPORT === "sse") {
    // HTTP/SSE transport
    const httpServer = createHttpServer(async (req, res) => {
      // CORS: restrict to localhost origins
      const origin = req.headers.origin;
      if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
      }
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Annabelle-Token");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Health check (always open — no token required)
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "healthy",
            transport: "http",
            port: PORT,
          })
        );
        return;
      }

      // Token auth: reject non-/health requests without valid token
      if (ANNABELLE_TOKEN && req.headers["x-annabelle-token"] !== ANNABELLE_TOKEN) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      if (req.url === "/sse" && req.method === "GET") {
        const transport = new SSEServerTransport("/messages", res);
        await server.connect(transport);
        return;
      }

      if (req.url === "/messages" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
        });
        return;
      }

      if (req.url === "/tools/list" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            tools: [
              {
                name: "web_search",
                description:
                  "Search the web for current information, facts, documentation, or any topic. Returns titles, URLs, and descriptions. Use freshness to filter by recency: '24h' for today's info, 'week' for this week, 'month' for this month. Do NOT use this for questions you can answer from your own knowledge.",
                inputSchema: zodToJsonSchema(webSearchSchema),
              },
              {
                name: "news_search",
                description:
                  "Search recent news articles. Use this instead of web_search when the user asks about current events, breaking news, or recent developments. Returns headlines, sources, and publication dates.",
                inputSchema: zodToJsonSchema(newsSearchSchema),
              },
              {
                name: "image_search",
                description:
                  "Search for images on the web. Returns direct image URLs and thumbnails. Use for finding photos, pictures, or visual content.",
                inputSchema: zodToJsonSchema(imageSearchSchema),
              },
            ],
          })
        );
        return;
      }

      if (req.url === "/tools/call" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", async () => {
          try {
            const { name, arguments: args } = JSON.parse(body);

            // Map tool name to handler and schema
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const toolMap: Record<string, { handler: (input: any) => Promise<unknown>; schema: any }> = {
              web_search: { handler: handleWebSearch, schema: webSearchSchema },
              news_search: { handler: handleNewsSearch, schema: newsSearchSchema },
              image_search: { handler: handleImageSearch, schema: imageSearchSchema },
            };

            const tool = toolMap[name];
            if (!tool) {
              res.writeHead(404, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: `Unknown tool: ${name}` }));
              return;
            }

            // Validate arguments with Zod schema
            const safeArgs = args === undefined ? {} : args;
            const parseResult = tool.schema.safeParse(safeArgs);

            if (!parseResult.success) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify({
                        error: `Invalid parameters: ${parseResult.error?.message}`,
                        success: false,
                      }),
                    },
                  ],
                })
              );
              return;
            }

            // Call handler with validated data
            const result = await tool.handler(parseResult.data);

            // Return MCP-compatible format
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({ success: true, data: result }),
                  },
                ],
              })
            );
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logger.error(`Tool call failed`, { tool: JSON.parse(body).name, error: errorMessage });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      error: errorMessage,
                      success: false,
                    }),
                  },
                ],
                isError: true,
              })
            );
          }
        });
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    httpServer.listen(PORT, "127.0.0.1", () => {
      logger.info(`Starting Searcher MCP`, { transport: TRANSPORT, port: PORT });
      logger.info(`Searcher MCP running on http://localhost:${PORT}`);
      logger.info(`Endpoints: GET /health, GET /tools/list, POST /tools/call, GET /sse`);
    });
  } else {
    // Default: stdio transport for Claude Desktop
    logger.info(`Starting Searcher MCP`, { transport: "stdio" });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info(`Searcher MCP running on stdio`);
  }

  // Graceful shutdown
  process.on("SIGINT", () => {
    logger.info("Shutting down...");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logger.info("Shutting down...");
    process.exit(0);
  });
}

main().catch((error) => {
  logger.error("Fatal error", error);
  process.exit(1);
});
