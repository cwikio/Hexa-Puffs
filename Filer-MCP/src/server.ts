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
    "Create a new file in the AI workspace. Use relative paths only (e.g., 'reports/analysis.md'). Set overwrite=true to replace an existing file.",
    createFileSchema,
    handleCreateFile
  );

  registerTool(
    "read_file",
    "Read a file's contents. Use relative paths for workspace files. For files outside the workspace, use absolute paths (requires an active grant — check with check_grant first).",
    readFileSchema,
    handleReadFile
  );

  registerTool(
    "list_files",
    "List files and folders in a directory. Defaults to workspace root. Use recursive=true to include all subdirectories.",
    listFilesSchema,
    handleListFiles
  );

  registerTool(
    "update_file",
    "Replace the contents of an existing file. A .bak backup is created by default. Works with workspace files and granted external paths.",
    updateFileSchema,
    handleUpdateFile
  );

  registerTool(
    "delete_file",
    "Delete a file from the workspace. Only works with workspace files — cannot delete external/granted files.",
    deleteFileSchema,
    handleDeleteFile
  );

  registerTool(
    "move_file",
    "Move or rename a file within the workspace. Both source and destination must be relative workspace paths.",
    moveFileSchema,
    handleMoveFile
  );

  registerTool(
    "copy_file",
    "Copy a file. Source can be a granted external path (absolute) or workspace path (relative). Destination must be a relative workspace path.",
    copyFileSchema,
    handleCopyFile
  );

  registerTool(
    "search_files",
    "Search for files by filename pattern or content text. Set search_type='content' to search inside files, 'filename' (default) to match file names. Set search_in='all' to include granted paths.",
    searchFilesSchema,
    handleSearchFiles
  );

  // Grant operations
  registerTool(
    "check_grant",
    "Check if the AI has read or write access to a path outside the workspace. Use this before attempting to read/write external files.",
    checkGrantSchema,
    handleCheckGrant
  );

  registerTool(
    "request_grant",
    "Request access to a path outside the workspace. Currently returns instructions for manual grant configuration.",
    requestGrantSchema,
    handleRequestGrant
  );

  registerTool(
    "list_grants",
    "List all active file access grants showing which external paths the AI can access and with what permissions.",
    listGrantsSchema,
    handleListGrants
  );

  // Info operations
  registerTool(
    "get_workspace_info",
    "Get the workspace root path, total file count, and disk usage statistics.",
    getWorkspaceInfoSchema,
    handleGetWorkspaceInfo
  );

  registerTool(
    "get_audit_log",
    "Get the audit log of all file operations. Filter by path prefix, operation type (e.g., 'read_file', 'create_file'), or date range.",
    getAuditLogSchema,
    handleGetAuditLog
  );

  return server;
}
