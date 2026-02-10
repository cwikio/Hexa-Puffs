/**
 * Filer MCP Server
 * Provides file operation tools with workspace isolation and grants system
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool } from "@mcp/shared/Utils/register-tool.js";
import { createSuccess } from "@mcp/shared/Types/StandardResponse.js";
import {
  createFileSchema, handleCreateFile,
  readFileSchema, handleReadFile,
  listFilesSchema, handleListFiles,
  updateFileSchema, handleUpdateFile,
  deleteFileSchema, handleDeleteFile,
  moveFileSchema, handleMoveFile,
  copyFileSchema, handleCopyFile,
  searchFilesSchema, handleSearchFiles,
  checkGrantSchema, handleCheckGrant,
  requestGrantSchema, handleRequestGrant,
  listGrantsSchema, handleListGrants,
  getWorkspaceInfoSchema, handleGetWorkspaceInfo,
  getAuditLogSchema, handleGetAuditLog,
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
      "Create a new file in the AI workspace.\n\nArgs:\n  - path (string): Relative path (e.g., 'reports/analysis.md')\n  - content (string): File contents\n  - overwrite (boolean, optional): Replace existing file (default: false)\n\nReturns: { path, size, created }",
    inputSchema: createFileSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleCreateFile(params);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "read_file",
    description:
      "Read a file's contents. Workspace files use relative paths. External files require absolute paths and an active grant (check with check_grant first).\n\nArgs:\n  - path (string): Relative workspace path or absolute granted path\n\nReturns: { path, content, size, modified }",
    inputSchema: readFileSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleReadFile(params);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "list_files",
    description:
      "List files and folders in a directory. Defaults to workspace root.\n\nArgs:\n  - path (string, optional): Directory to list (default: workspace root)\n  - recursive (boolean, optional): Include all subdirectories (default: false)\n\nReturns: { path, entries: [{ name, type, size, modified }] }",
    inputSchema: listFilesSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleListFiles(params);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "update_file",
    description:
      "Replace the contents of an existing file. Creates a .bak backup by default. Works with workspace files and granted external paths.\n\nArgs:\n  - path (string): File path (relative or granted absolute)\n  - content (string): New file contents\n  - create_backup (boolean, optional): Create .bak backup (default: true)\n\nReturns: { path, size, modified, backup_path? }",
    inputSchema: updateFileSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleUpdateFile(params);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "delete_file",
    description:
      "Delete a file from the workspace. Only works with workspace files — cannot delete external/granted files.\n\nArgs:\n  - path (string): Relative workspace path\n\nReturns: { path, deleted }",
    inputSchema: deleteFileSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleDeleteFile(params);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "move_file",
    description:
      "Move or rename a file within the workspace. Both paths must be relative workspace paths.\n\nArgs:\n  - source (string): Current relative path\n  - destination (string): New relative path\n\nReturns: { source, destination, moved }",
    inputSchema: moveFileSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleMoveFile(params);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "copy_file",
    description:
      "Copy a file. Source can be a granted external path (absolute) or workspace path (relative). Destination must be a relative workspace path.\n\nArgs:\n  - source (string): Source path (relative or granted absolute)\n  - destination (string): Destination relative workspace path\n\nReturns: { source, destination, copied }",
    inputSchema: copyFileSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleCopyFile(params);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "search_files",
    description:
      "Search for files by name pattern or content text.\n\nArgs:\n  - query (string): Search pattern or text\n  - search_type (string, optional): 'filename' (default) or 'content'\n  - search_in (string, optional): 'workspace' (default), 'granted', or 'all'\n  - file_types (string[], optional): Filter by file extensions\n\nReturns: { query, matches: [{ path, type?, line?, context? }] }",
    inputSchema: searchFilesSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleSearchFiles(params);
      return createSuccess(result);
    },
  });

  // Grant operations

  registerTool(server, {
    name: "check_grant",
    description:
      "Check if the AI has access to a path outside the workspace. Call before attempting external file operations.\n\nArgs:\n  - path (string): Absolute path to check\n\nReturns: { path, granted, permission, grant_details? }",
    inputSchema: checkGrantSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleCheckGrant(params);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "request_grant",
    description:
      "Request access to a path outside the workspace. Returns instructions for manual grant configuration.\n\nArgs:\n  - path (string): Absolute path to request access to\n  - permission (string): 'read' or 'read-write'\n  - reason (string): Why access is needed\n\nReturns: { path, instructions }",
    inputSchema: requestGrantSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleRequestGrant(params);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "list_grants",
    description:
      "List all active file access grants showing which external paths the AI can access and with what permissions.\n\nReturns: { grants: [{ path, permission, created }] }",
    inputSchema: listGrantsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleListGrants(params);
      return createSuccess(result);
    },
  });

  // Info operations

  registerTool(server, {
    name: "get_workspace_info",
    description:
      "Get workspace root path, total file count, and disk usage statistics.\n\nReturns: { workspace_path, file_count, total_size, free_space }",
    inputSchema: getWorkspaceInfoSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleGetWorkspaceInfo(params);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "get_audit_log",
    description:
      "Get the audit log of file operations. Filter by path, operation type, or date range.\n\nArgs:\n  - path_filter (string, optional): Filter by path prefix\n  - operation_filter (string, optional): Filter by operation (e.g., 'read_file', 'create_file')\n  - date_from (string, optional): ISO date — only entries after this date\n  - limit (number, optional): Max entries to return (default: 100)\n\nReturns: { entries: [{ timestamp, operation, path, details }], total }",
    inputSchema: getAuditLogSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => {
      const result = await handleGetAuditLog(params);
      return createSuccess(result);
    },
  });

  return server;
}
