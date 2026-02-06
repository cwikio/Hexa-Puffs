/**
 * Filer MCP Server
 * Provides file operation tools with workspace isolation and grants system
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { StandardResponse } from "./types/shared.js";
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

type ZodSchema = z.ZodObject<z.ZodRawShape>;

export function createServer(): McpServer {
  const server = new McpServer({
    name: "filer",
    version: "1.0.0",
  });

  // Helper to wrap tool handlers with standard error handling
  function registerTool<T>(
    name: string,
    description: string,
    schema: ZodSchema,
    handler: (input: T) => Promise<unknown>
  ): void {
    server.tool(name, description, schema.shape, async (params) => {
      console.error(`[DEBUG] Tool ${name} called`);
      console.error(`[DEBUG] params type:`, typeof params);
      console.error(`[DEBUG] params value:`, params);
      console.error(`[DEBUG] params is undefined:`, params === undefined);
      console.error(`[DEBUG] params JSON:`, JSON.stringify(params));

      // If params is undefined, default to empty object
      const safeParams = params === undefined ? {} : params;
      const result = schema.safeParse(safeParams);
      console.error(`[DEBUG] Zod parse result:`, result.success ? 'SUCCESS' : 'FAILED', result.success ? JSON.stringify(result.data) : result.error.message);
      if (!result.success) {
        const response: StandardResponse = {
          success: false,
          error: `Invalid parameters: ${result.error.message}`,
        };
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(response),
            },
          ],
        };
      }

      try {
        const output = await handler(result.data as T);
        const response: StandardResponse<unknown> = {
          success: true,
          data: output,
        };
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(response),
            },
          ],
        };
      } catch (error) {
        const response: StandardResponse = {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(response),
            },
          ],
        };
      }
    });
  }

  // Register all 13 tools

  // File operations
  registerTool(
    "create_file",
    "Create a file in AI workspace. Path must be relative (e.g., Documents/reports/analysis.md)",
    createFileSchema,
    handleCreateFile
  );

  registerTool(
    "read_file",
    "Read a file. Workspace paths are relative, external paths require grants.",
    readFileSchema,
    handleReadFile
  );

  registerTool(
    "list_files",
    "List files in a directory. Use recursive=true to list subdirectories.",
    listFilesSchema,
    handleListFiles
  );

  registerTool(
    "update_file",
    "Update an existing file. Creates backup by default.",
    updateFileSchema,
    handleUpdateFile
  );

  registerTool(
    "delete_file",
    "Delete a file from workspace. Cannot delete external files.",
    deleteFileSchema,
    handleDeleteFile
  );

  registerTool(
    "move_file",
    "Move or rename a file within workspace.",
    moveFileSchema,
    handleMoveFile
  );

  registerTool(
    "copy_file",
    "Copy a file. Can copy from granted paths into workspace.",
    copyFileSchema,
    handleCopyFile
  );

  registerTool(
    "search_files",
    "Search for files by filename or content.",
    searchFilesSchema,
    handleSearchFiles
  );

  // Grant operations
  registerTool(
    "check_grant",
    "Check if AI has access to an external path.",
    checkGrantSchema,
    handleCheckGrant
  );

  registerTool(
    "request_grant",
    "Request access to an external path. In MVP, returns instructions to configure grants.",
    requestGrantSchema,
    handleRequestGrant
  );

  registerTool(
    "list_grants",
    "List all active file access grants.",
    listGrantsSchema,
    handleListGrants
  );

  // Info operations
  registerTool(
    "get_workspace_info",
    "Get workspace location and statistics.",
    getWorkspaceInfoSchema,
    handleGetWorkspaceInfo
  );

  registerTool(
    "get_audit_log",
    "Get file operation audit log with optional filters.",
    getAuditLogSchema,
    handleGetAuditLog
  );

  return server;
}
