// Load environment variables from .env file
import { config as dotenvConfig } from "dotenv";
dotenvConfig();

// Suppress console.log to prevent GramJS logs from polluting MCP stdout
// GramJS writes colored log messages to console.log which breaks JSON-RPC
console.log = () => {};

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "./server.js";
import { createServer as createHttpServer } from "http";
import { allTools } from "./tools/index.js";
import type { StandardResponse } from "./types/shared.js";

const transport = process.env.TRANSPORT || "stdio";
const port = parseInt(process.env.PORT || "3000", 10);

async function main() {
  const server = createServer();

  if (transport === "http" || transport === "sse") {
    const httpServer = createHttpServer(async (req, res) => {
      if (req.method === "GET" && req.url === "/sse") {
        const sseTransport = new SSEServerTransport("/message", res);
        await server.connect(sseTransport);
      } else if (req.method === "POST" && req.url === "/message") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ received: true }));
        });
      } else if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } else if (req.url === "/tools/call" && req.method === "POST") {
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

            const output = await toolEntry.handler(args || {});
            const response: StandardResponse<unknown> = {
              success: true,
              data: output,
            };
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                content: [{ type: "text", text: JSON.stringify(response) }],
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
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    httpServer.listen(port, () => {
      console.error(`Telegram MCP server running on http://localhost:${port}`);
      console.error(`SSE endpoint: http://localhost:${port}/sse`);
    });
  } else {
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
    console.error("Telegram MCP server running on stdio");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
