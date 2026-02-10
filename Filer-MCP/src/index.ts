/**
 * Filer MCP Server - Entry Point
 * Supports both stdio and HTTP/SSE transports
 */

import { loadEnvSafely } from "@mcp/shared/Utils/env.js";
loadEnvSafely(import.meta.url);

import { existsSync } from "node:fs";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "./server.js";
import { createServer as createHttpServer } from "node:http";
import { initDatabase } from "./db/index.js";
import { loadConfigGrants } from "./db/grants.js";
import { initializeWorkspace } from "./utils/workspace.js";
import { getConfig } from "./utils/config.js";
import { cleanupTempFiles } from "./services/cleanup.js";
import { Logger } from "@mcp/shared/Utils/logger.js";
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

const logger = new Logger('filer');
const TRANSPORT = process.env.TRANSPORT || "stdio";
const PORT = parseInt(process.env.PORT || "8004", 10);

async function main() {
  const config = getConfig();

  // Initialize grants storage
  try {
    await initDatabase();
    logger.info("Grants storage initialized");
  } catch (error) {
    logger.error("Grants storage initialization error:", error);
    process.exit(1);
  }

  // Load grants from config file
  try {
    const loadedGrants = await loadConfigGrants();
    if (loadedGrants > 0) {
      logger.info(`Loaded ${loadedGrants} grants from config`);
    }
  } catch (error) {
    logger.warn("Could not load config grants", error);
  }

  // Initialize workspace
  try {
    await initializeWorkspace();
    logger.info(`Workspace initialized at: ${config.workspace.path}`);
  } catch (error) {
    logger.error("Workspace initialization error", error);
    process.exit(1);
  }

  // Clean up old temp files
  try {
    const cleanupResult = await cleanupTempFiles();
    if (cleanupResult.deleted > 0) {
      logger.info(`Temp cleanup: ${cleanupResult.deleted} files deleted (older than ${config.cleanup.tempDays} days)`);
    }
    if (cleanupResult.errors > 0) {
      logger.warn(`Temp cleanup: ${cleanupResult.errors} errors`);
    }
  } catch (error) {
    logger.warn("Temp cleanup failed", error);
  }

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
        const workspaceExists = existsSync(config.workspace.path);
        const status = workspaceExists ? "healthy" : "degraded";
        res.writeHead(workspaceExists ? 200 : 503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status,
            transport: "http",
            workspace: config.workspace.path,
            ...(workspaceExists ? {} : { error: "workspace directory not found" }),
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

    httpServer.listen(PORT, "127.0.0.1", () => {
      logger.info(`Starting Filer MCP`, { transport: TRANSPORT, port: PORT });
      logger.info(`Workspace: ${config.workspace.path}`);
      logger.info(`Filer MCP running on http://localhost:${PORT}`);
      logger.info(`Endpoints: GET /health, GET /sse, POST /message`);
    });
  } else {
    // Default: stdio transport for Claude Desktop
    logger.info(`Starting Filer MCP`, { transport: "stdio" });
    logger.info(`Workspace: ${config.workspace.path}`);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info(`Filer MCP running on stdio`);
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
