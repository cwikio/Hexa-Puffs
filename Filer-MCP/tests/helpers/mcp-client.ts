/**
 * MCP Client Test Helper for Filer MCP.
 * Uses shared base client, adds Filer-specific convenience methods.
 */

import { MCPTestClient, type MCPToolCallResult } from '@mcp/shared/Testing/mcp-test-client.js';
export { log, logSection } from '@mcp/shared/Testing/test-utils.js';
export { type MCPToolCallResult } from '@mcp/shared/Testing/mcp-test-client.js';

export const FILER_URL = process.env.FILER_URL || "http://localhost:8004";

const client = new MCPTestClient('Filer', FILER_URL);

export function logInfo(message: string): void {
  const ts = new Date().toISOString().split("T")[1].slice(0, 12);
  console.log(`[${ts}] ℹ ${message}`);
}

export function logSuccess(message: string, duration?: number): void {
  const ts = new Date().toISOString().split("T")[1].slice(0, 12);
  const d = duration !== undefined ? ` (${duration}ms)` : "";
  console.log(`[${ts}] ✓ ${message}${d}`);
}

export function logError(message: string, error?: string): void {
  const ts = new Date().toISOString().split("T")[1].slice(0, 12);
  console.log(`[${ts}] ✗ ${message}${error ? ` - ${error}` : ""}`);
}

export async function checkHealth(): Promise<boolean> {
  logInfo(`Checking health at ${FILER_URL}/health`);
  const result = await client.healthCheck();
  if (result.healthy) {
    logSuccess("Health check passed", result.duration);
  } else {
    logError("Health check failed", result.error || `Status ${result.status}`);
  }
  return result.healthy;
}

export async function callTool<T = unknown>(
  name: string,
  args: Record<string, unknown> = {}
): Promise<MCPToolCallResult<T>> {
  logInfo(`Calling ${name} tool`);
  const result = await client.callTool<T>(name, args);
  if (result.success) {
    logSuccess(`${name} succeeded`, result.duration);
  } else {
    logError(`${name} failed`, result.error);
  }
  return result;
}

// Convenience methods for each tool - types match actual API responses

export const tools = {
  createFile: (path: string, content: string, overwrite = false) =>
    callTool<{ full_path: string; created_at: string; size_bytes: number }>(
      "create_file",
      { path, content, overwrite }
    ),

  readFile: (path: string) =>
    callTool<{ content: string; size_bytes: number; full_path: string }>("read_file", { path }),

  listFiles: (path = ".", recursive = false) =>
    callTool<{
      path: string;
      files: Array<{ name: string; type: "file" | "directory"; size_bytes?: number; modified_at?: string }>;
    }>("list_files", { path, recursive }),

  updateFile: (path: string, content: string, create_backup = true) =>
    callTool<{ full_path: string; backup_path?: string; size_bytes: number }>("update_file", {
      path,
      content,
      create_backup,
    }),

  deleteFile: (path: string) =>
    callTool<{ full_path: string; deleted_at: string }>("delete_file", { path }),

  moveFile: (source: string, destination: string) =>
    callTool<{ source_path: string; destination_path: string }>("move_file", { source, destination }),

  copyFile: (source: string, destination: string) =>
    callTool<{ source_path: string; destination_path: string; size_bytes: number }>(
      "copy_file",
      { source, destination }
    ),

  searchFiles: (
    query: string,
    options?: { search_in?: string; search_type?: string; file_types?: string[] }
  ) =>
    callTool<{
      query: string;
      search_path: string;
      results: Array<{ path: string; name: string; type: string; matches?: Array<{ line: number; content: string }> }>;
    }>("search_files", { query, ...options }),

  checkGrant: (path: string) =>
    callTool<{ path: string; has_grant: boolean; permission?: string; grant_id?: string }>(
      "check_grant",
      { path }
    ),

  requestGrant: (path: string, permission: "read" | "read-write", reason = "Testing") =>
    callTool<{ status: string; grant_id?: string; message: string }>("request_grant", {
      path,
      permission,
      reason,
    }),

  listGrants: () =>
    callTool<{ grants: Array<{ id: string; path: string; permission: string; scope: string }> }>(
      "list_grants",
      {}
    ),

  getWorkspaceInfo: () =>
    callTool<{
      workspace_path: string;
      total_files: number;
      total_size_mb: number;
      temp_files: number;
    }>("get_workspace_info", {}),

  getAuditLog: (options?: {
    path_filter?: string;
    operation_filter?: string;
    date_from?: string;
    limit?: number;
  }) =>
    callTool<{
      entries: Array<{
        timestamp: string;
        operation: string;
        path: string;
        success: boolean;
        domain?: string;
        error?: string;
      }>;
    }>("get_audit_log", options || {}),
};
