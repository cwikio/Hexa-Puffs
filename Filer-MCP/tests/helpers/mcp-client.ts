/**
 * MCP Client Test Helper
 * HTTP wrapper with rich logging for testing Filer MCP server
 */

const FILER_URL = process.env.FILER_URL || "http://localhost:8004";

interface ToolCallResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  duration: number;
}

interface McpResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
}

function timestamp(): string {
  return new Date().toISOString().split("T")[1].slice(0, 12);
}

function log(icon: string, message: string, detail?: string): void {
  const time = timestamp();
  if (detail) {
    console.log(`[${time}] ${icon} ${message} ${detail}`);
  } else {
    console.log(`[${time}] ${icon} ${message}`);
  }
}

export function logInfo(message: string): void {
  log("ℹ", message);
}

export function logSuccess(message: string, duration?: number): void {
  const durationStr = duration !== undefined ? `(${duration}ms)` : "";
  log("✓", message, durationStr);
}

export function logError(message: string, error?: string): void {
  log("✗", message, error ? `- ${error}` : undefined);
}

export function logSection(title: string): void {
  console.log();
  console.log(`━━━ ${title} ━━━`);
  console.log();
}

/**
 * Check if the Filer MCP server is healthy
 */
export async function checkHealth(): Promise<boolean> {
  logInfo(`Checking health at ${FILER_URL}/health`);
  const start = Date.now();

  try {
    const response = await fetch(`${FILER_URL}/health`);
    const duration = Date.now() - start;

    if (response.ok) {
      logSuccess("Health check passed", duration);
      return true;
    } else {
      logError("Health check failed", `Status ${response.status}`);
      return false;
    }
  } catch (error) {
    logError("Health check failed", error instanceof Error ? error.message : "Unknown error");
    return false;
  }
}

/**
 * Call a tool on the Filer MCP server
 */
export async function callTool<T = unknown>(
  name: string,
  args: Record<string, unknown> = {}
): Promise<ToolCallResult<T>> {
  logInfo(`Calling ${name} tool`);
  const start = Date.now();

  try {
    const response = await fetch(`${FILER_URL}/tools/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        arguments: args,
      }),
    });

    const duration = Date.now() - start;

    if (!response.ok) {
      const errorText = await response.text();
      logError(`${name} failed`, `Status ${response.status}: ${errorText}`);
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText}`,
        duration,
      };
    }

    const mcpResponse = (await response.json()) as McpResponse;

    // Parse the tool result from MCP response format
    if (mcpResponse.content && mcpResponse.content[0]?.text) {
      const toolResult = JSON.parse(mcpResponse.content[0].text) as T;

      // Check if the tool result indicates success
      const resultObj = toolResult as { success?: boolean; error?: string };
      if (resultObj.success === false) {
        logError(`${name} returned error`, resultObj.error);
        return {
          success: false,
          error: resultObj.error,
          data: toolResult,
          duration,
        };
      }

      logSuccess(`${name} succeeded`, duration);
      return {
        success: true,
        data: toolResult,
        duration,
      };
    }

    logError(`${name} returned unexpected format`);
    return {
      success: false,
      error: "Unexpected response format",
      duration,
    };
  } catch (error) {
    const duration = Date.now() - start;
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    logError(`${name} failed`, errorMsg);
    return {
      success: false,
      error: errorMsg,
      duration,
    };
  }
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

export { FILER_URL };
