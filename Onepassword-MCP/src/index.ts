import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "./server.js";
import { createServer as createHttpServer } from "node:http";
import { Logger } from "@mcp/shared/Utils/logger.js";
import { checkAuth } from "./op/client.js";

const logger = new Logger('1password');

const TRANSPORT = process.env.TRANSPORT || "stdio";
const PORT = parseInt(process.env.PORT || "3000", 10);

async function main() {
  const server = createServer();

  if (TRANSPORT === "http" || TRANSPORT === "sse") {
    // HTTP/SSE transport for LM Studio and other HTTP clients
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

      if (req.url === "/sse" && req.method === "GET") {
        const transport = new SSEServerTransport("/messages", res);
        await server.connect(transport);
        return;
      }

      if (req.url === "/messages" && req.method === "POST") {
        // Handle POST messages for SSE transport
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
        const auth = await checkAuth();
        const status = auth.authenticated ? "healthy" : "degraded";
        const httpStatus = auth.authenticated ? 200 : 503;
        res.writeHead(httpStatus, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status,
          transport: "http",
          opCli: auth.authenticated ? "authenticated" : "unauthenticated",
          ...(auth.account ? { account: auth.account } : {}),
          ...(auth.error ? { error: auth.error } : {}),
        }));
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    httpServer.listen(PORT, "127.0.0.1", () => {
      logger.info(`1Password MCP server listening on port ${PORT}`);
      logger.info(`SSE endpoint: http://localhost:${PORT}/sse`);
      logger.info(`Health check: http://localhost:${PORT}/health`);
    });
  } else {
    // Default: stdio transport for Claude Desktop
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("1Password MCP server running on stdio");
  }
}

main().catch((error) => {
  logger.error("Fatal error", error);
  process.exit(1);
});
