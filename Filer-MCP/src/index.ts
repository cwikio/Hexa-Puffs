/**
 * Filer MCP Server - Entry Point
 * Supports both stdio and HTTP/SSE transports
 */

import { config as dotenvConfig } from "dotenv";
dotenvConfig();

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "./server.js";
import { createServer as createHttpServer } from "node:http";
import { initDatabase } from "./db/index.js";
import { loadConfigGrants } from "./db/grants.js";
import { initializeWorkspace } from "./utils/workspace.js";
import { getConfig } from "./utils/config.js";
import { cleanupTempFiles } from "./services/cleanup.js";
import {
  createFileSchema,
  handleCreateFile,
  readFileSchema,
  handleReadFile,
  listFilesSchema,
  handleListFiles,
  updateFileSchema,
  handleUpdateFile,
  deleteFileSchema,
  handleDeleteFile,
  moveFileSchema,
  handleMoveFile,
  copyFileSchema,
  handleCopyFile,
  searchFilesSchema,
  handleSearchFiles,
  checkGrantSchema,
  handleCheckGrant,
  requestGrantSchema,
  handleRequestGrant,
  listGrantsSchema,
  handleListGrants,
  getWorkspaceInfoSchema,
  handleGetWorkspaceInfo,
  getAuditLogSchema,
  handleGetAuditLog,
} from "./tools/index.js";

const TRANSPORT = process.env.TRANSPORT || "stdio";
const PORT = parseInt(process.env.PORT || "8004", 10);

async function main() {
  const config = getConfig();

  // Initialize grants storage
  try {
    await initDatabase();
    console.error("Grants storage initialized");
  } catch (error) {
    console.error("Grants storage initialization error:", error);
    process.exit(1);
  }

  // Load grants from config file
  try {
    const loadedGrants = await loadConfigGrants();
    if (loadedGrants > 0) {
      console.error(`Loaded ${loadedGrants} grants from config`);
    }
  } catch (error) {
    console.error("Warning: Could not load config grants:", error);
  }

  // Initialize workspace
  try {
    await initializeWorkspace();
    console.error("Workspace initialized at:", config.workspace.path);
  } catch (error) {
    console.error("Workspace initialization error:", error);
    process.exit(1);
  }

  // Clean up old temp files
  try {
    const cleanupResult = await cleanupTempFiles();
    if (cleanupResult.deleted > 0) {
      console.error(
        `Temp cleanup: ${cleanupResult.deleted} files deleted (older than ${config.cleanup.tempDays} days)`
      );
    }
    if (cleanupResult.errors > 0) {
      console.error(`Temp cleanup: ${cleanupResult.errors} errors`);
    }
  } catch (error) {
    console.error("Warning: Temp cleanup failed:", error);
  }

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
            workspace: config.workspace.path,
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
            const toolMap: Record<string, { handler: (input: any) => Promise<unknown>, schema: any }> = {
              create_file: { handler: handleCreateFile, schema: createFileSchema },
              read_file: { handler: handleReadFile, schema: readFileSchema },
              list_files: { handler: handleListFiles, schema: listFilesSchema },
              update_file: { handler: handleUpdateFile, schema: updateFileSchema },
              delete_file: { handler: handleDeleteFile, schema: deleteFileSchema },
              move_file: { handler: handleMoveFile, schema: moveFileSchema },
              copy_file: { handler: handleCopyFile, schema: copyFileSchema },
              search_files: { handler: handleSearchFiles, schema: searchFilesSchema },
              check_grant: { handler: handleCheckGrant, schema: checkGrantSchema },
              request_grant: { handler: handleRequestGrant, schema: requestGrantSchema },
              list_grants: { handler: handleListGrants, schema: listGrantsSchema },
              get_workspace_info: { handler: handleGetWorkspaceInfo, schema: getWorkspaceInfoSchema },
              get_audit_log: { handler: handleGetAuditLog, schema: getAuditLogSchema },
            };

            const tool = toolMap[name];
            if (!tool) {
              res.writeHead(404, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: `Unknown tool: ${name}` }));
              return;
            }

            // Validate arguments with Zod schema (use empty object if undefined)
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
                        error: `Invalid parameters: ${parseResult.error.message}`,
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
                content: [{ type: "text", text: JSON.stringify(result) }],
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
                      error: error instanceof Error ? error.message : "Unknown error",
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
      console.error(`[${new Date().toISOString()}] [INFO] [filer-mcp] Starting Filer MCP {"transport":"${TRANSPORT}","port":${PORT}}`);
      console.error(`[${new Date().toISOString()}] [INFO] [filer-mcp] Workspace: ${config.workspace.path}`);
      console.error(`[${new Date().toISOString()}] [INFO] [filer-mcp] Filer MCP running on http://localhost:${PORT}`);
      console.error(`[${new Date().toISOString()}] [INFO] [filer-mcp] Endpoints:`);
      console.error(`[${new Date().toISOString()}] [INFO] [filer-mcp]   GET  /health - Health check`);
      console.error(`[${new Date().toISOString()}] [INFO] [filer-mcp]   GET  /sse    - SSE connection`);
      console.error(`[${new Date().toISOString()}] [INFO] [filer-mcp]   POST /message - SSE messages`);
    });
  } else {
    // Default: stdio transport for Claude Desktop
    console.error(`[${new Date().toISOString()}] [INFO] [filer-mcp] Starting Filer MCP {"transport":"stdio"}`);
    console.error(`[${new Date().toISOString()}] [INFO] [filer-mcp] Workspace: ${config.workspace.path}`);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`[${new Date().toISOString()}] [INFO] [filer-mcp] Filer MCP running on stdio`);
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
