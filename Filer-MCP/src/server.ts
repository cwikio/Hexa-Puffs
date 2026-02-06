/**
 * Filer MCP Server
 * Provides file operation tools with workspace isolation and grants system
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool } from "@mcp/shared/Utils/register-tool.js";
import { createSuccess } from "@mcp/shared/Types/StandardResponse.js";
import {
  createFileSchema, handleCreateFile, type CreateFileInput,
  readFileSchema, handleReadFile, type ReadFileInput,
  listFilesSchema, handleListFiles, type ListFilesInput,
  updateFileSchema, handleUpdateFile, type UpdateFileInput,
  deleteFileSchema, handleDeleteFile, type DeleteFileInput,
  moveFileSchema, handleMoveFile, type MoveFileInput,
  copyFileSchema, handleCopyFile, type CopyFileInput,
  searchFilesSchema, handleSearchFiles, type SearchFilesInput,
  checkGrantSchema, handleCheckGrant, type CheckGrantInput,
  requestGrantSchema, handleRequestGrant, type RequestGrantInput,
  listGrantsSchema, handleListGrants, type ListGrantsInput,
  getWorkspaceInfoSchema, handleGetWorkspaceInfo, type GetWorkspaceInfoInput,
  getAuditLogSchema, handleGetAuditLog, type GetAuditLogInput,
} from "./tools/index.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "filer",
    version: "1.0.0",
  });

  // File operations

  registerTool(server, {
    name: "create_file",
    description:
      "Create a new file in the AI workspace. Use relative paths only (e.g., 'reports/analysis.md'). Set overwrite=true to replace an existing file.",
    inputSchema: createFileSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleCreateFile(params as CreateFileInput);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "read_file",
    description:
      "Read a file's contents. Use relative paths for workspace files. For files outside the workspace, use absolute paths (requires an active grant — check with check_grant first).",
    inputSchema: readFileSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleReadFile(params as ReadFileInput);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "list_files",
    description:
      "List files and folders in a directory. Defaults to workspace root. Use recursive=true to include all subdirectories.",
    inputSchema: listFilesSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleListFiles(params as ListFilesInput);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "update_file",
    description:
      "Replace the contents of an existing file. A .bak backup is created by default. Works with workspace files and granted external paths.",
    inputSchema: updateFileSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleUpdateFile(params as UpdateFileInput);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "delete_file",
    description:
      "Delete a file from the workspace. Only works with workspace files — cannot delete external/granted files.",
    inputSchema: deleteFileSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleDeleteFile(params as DeleteFileInput);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "move_file",
    description:
      "Move or rename a file within the workspace. Both source and destination must be relative workspace paths.",
    inputSchema: moveFileSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleMoveFile(params as MoveFileInput);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "copy_file",
    description:
      "Copy a file. Source can be a granted external path (absolute) or workspace path (relative). Destination must be a relative workspace path.",
    inputSchema: copyFileSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleCopyFile(params as CopyFileInput);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "search_files",
    description:
      "Search for files by filename pattern or content text. Set search_type='content' to search inside files, 'filename' (default) to match file names. Set search_in='all' to include granted paths.",
    inputSchema: searchFilesSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleSearchFiles(params as SearchFilesInput);
      return createSuccess(result);
    },
  });

  // Grant operations

  registerTool(server, {
    name: "check_grant",
    description:
      "Check if the AI has read or write access to a path outside the workspace. Use this before attempting to read/write external files.",
    inputSchema: checkGrantSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleCheckGrant(params as CheckGrantInput);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "request_grant",
    description:
      "Request access to a path outside the workspace. Currently returns instructions for manual grant configuration.",
    inputSchema: requestGrantSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleRequestGrant(params as RequestGrantInput);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "list_grants",
    description:
      "List all active file access grants showing which external paths the AI can access and with what permissions.",
    inputSchema: listGrantsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleListGrants(params as ListGrantsInput);
      return createSuccess(result);
    },
  });

  // Info operations

  registerTool(server, {
    name: "get_workspace_info",
    description:
      "Get the workspace root path, total file count, and disk usage statistics.",
    inputSchema: getWorkspaceInfoSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleGetWorkspaceInfo(params as GetWorkspaceInfoInput);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "get_audit_log",
    description:
      "Get the audit log of all file operations. Filter by path prefix, operation type (e.g., 'read_file', 'create_file'), or date range.",
    inputSchema: getAuditLogSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleGetAuditLog(params as GetAuditLogInput);
      return createSuccess(result);
    },
  });

  return server;
}
