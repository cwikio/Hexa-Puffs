/**
 * Searcher MCP Server - Entry Point
 * Supports both stdio and HTTP/SSE transports
 */

import { config as dotenvConfig } from "dotenv";
dotenvConfig();

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "./server.js";
import { createServer as createHttpServer } from "node:http";
import { getConfig } from "./utils/config.js";
import {
  webSearchSchema,
  handleWebSearch,
  newsSearchSchema,
  handleNewsSearch,
} from "./tools/index.js";

const TRANSPORT = process.env.TRANSPORT || "stdio";
const PORT = parseInt(process.env.PORT || "8007", 10);

async function main() {
  // Validate config (will throw if BRAVE_API_KEY is missing)
  const config = getConfig();

  const server = createServer();

  if (TRANSPORT === "http" || TRANSPORT === "sse") {
    // HTTP/SSE transport
    const httpServer = createHttpServer(async (req, res) => {
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

      if (req.url === "/tools/list" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            tools: [
              {
                name: "web_search",
                description:
                  "Search the web for current information, facts, documentation, or any topic. Returns titles, URLs, and descriptions. Use freshness to filter by recency: '24h' for today's info, 'week' for this week, 'month' for this month. Do NOT use this for questions you can answer from your own knowledge.",
                inputSchema: {
                  type: "object",
                  properties: webSearchSchema.shape,
                  required: ["query"],
                },
              },
              {
                name: "news_search",
                description:
                  "Search recent news articles. Use this instead of web_search when the user asks about current events, breaking news, or recent developments. Returns headlines, sources, and publication dates.",
                inputSchema: {
                  type: "object",
                  properties: newsSearchSchema.shape,
                  required: ["query"],
                },
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
              news_search: {
                handler: handleNewsSearch,
                schema: newsSearchSchema,
              },
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
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      error:
                        error instanceof Error ? error.message : "Unknown error",
                      success: false,
                    }),
                  },
                ],
              })
            );
          }
        });
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    httpServer.listen(PORT, () => {
      console.error(
        `[${new Date().toISOString()}] [INFO] [searcher-mcp] Starting Searcher MCP {"transport":"${TRANSPORT}","port":${PORT}}`
      );
      console.error(
        `[${new Date().toISOString()}] [INFO] [searcher-mcp] Searcher MCP running on http://localhost:${PORT}`
      );
      console.error(
        `[${new Date().toISOString()}] [INFO] [searcher-mcp] Endpoints:`
      );
      console.error(
        `[${new Date().toISOString()}] [INFO] [searcher-mcp]   GET  /health      - Health check`
      );
      console.error(
        `[${new Date().toISOString()}] [INFO] [searcher-mcp]   GET  /tools/list  - List available tools`
      );
      console.error(
        `[${new Date().toISOString()}] [INFO] [searcher-mcp]   POST /tools/call  - Call a tool`
      );
      console.error(
        `[${new Date().toISOString()}] [INFO] [searcher-mcp]   GET  /sse         - SSE connection`
      );
    });
  } else {
    // Default: stdio transport for Claude Desktop
    console.error(
      `[${new Date().toISOString()}] [INFO] [searcher-mcp] Starting Searcher MCP {"transport":"stdio"}`
    );
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(
      `[${new Date().toISOString()}] [INFO] [searcher-mcp] Searcher MCP running on stdio`
    );
  }

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.error("Shutting down...");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.error("Shutting down...");
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
