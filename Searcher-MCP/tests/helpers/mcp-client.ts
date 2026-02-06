/**
 * MCP Client Test Helper
 * HTTP wrapper with rich logging for testing Searcher MCP server
 */

const SEARCHER_URL = process.env.SEARCHER_URL || "http://localhost:8007";

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
  log("i", message);
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
 * Check if the Searcher MCP server is healthy
 */
export async function checkHealth(): Promise<boolean> {
  logInfo(`Checking health at ${SEARCHER_URL}/health`);
  const start = Date.now();

  try {
    const response = await fetch(`${SEARCHER_URL}/health`);
    const duration = Date.now() - start;

    if (response.ok) {
      logSuccess("Health check passed", duration);
      return true;
    } else {
      logError("Health check failed", `Status ${response.status}`);
      return false;
    }
  } catch (error) {
    logError(
      "Health check failed",
      error instanceof Error ? error.message : "Unknown error"
    );
    return false;
  }
}

/**
 * Get health check response data
 */
export async function getHealthData(): Promise<{
  status: string;
  transport: string;
  port: number;
} | null> {
  try {
    const response = await fetch(`${SEARCHER_URL}/health`);
    if (response.ok) {
      return response.json();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * List available tools
 */
export async function listTools(): Promise<{
  tools: Array<{
    name: string;
    description: string;
    inputSchema: object;
  }>;
} | null> {
  try {
    const response = await fetch(`${SEARCHER_URL}/tools/list`);
    if (response.ok) {
      return response.json();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Call a tool on the Searcher MCP server
 */
export async function callTool<T = unknown>(
  name: string,
  args: Record<string, unknown> = {}
): Promise<ToolCallResult<T>> {
  logInfo(`Calling ${name} tool`);
  const start = Date.now();

  try {
    const response = await fetch(`${SEARCHER_URL}/tools/call`, {
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

      // For 400 errors (validation), try to parse the error response
      if (response.status === 400) {
        try {
          const errorJson = JSON.parse(errorText) as McpResponse;
          if (errorJson.content?.[0]?.text) {
            const toolResult = JSON.parse(errorJson.content[0].text);
            return {
              success: false,
              error: toolResult.error,
              data: toolResult as T,
              duration,
            };
          }
        } catch {
          // Fall through to default error handling
        }
      }

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

// Type definitions matching the actual API responses

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  age?: string;
}

export interface WebSearchData {
  results: WebSearchResult[];
  total_count: number;
  query: string;
}

export interface NewsResult {
  title: string;
  url: string;
  description: string;
  source: string;
  age: string;
  thumbnail?: string;
  breaking?: boolean;
}

export interface NewsSearchData {
  results: NewsResult[];
  total_count: number;
  query: string;
}

export interface StandardResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Convenience methods for each tool

export const tools = {
  /**
   * Search the web using Brave Search
   * @param query - Search query (required)
   * @param options - Optional parameters: count (1-20), freshness (24h/week/month/year), safesearch (off/moderate/strict)
   */
  webSearch: (
    query: string,
    options?: {
      count?: number;
      freshness?: "24h" | "week" | "month" | "year";
      safesearch?: "off" | "moderate" | "strict";
    }
  ) =>
    callTool<StandardResponse<WebSearchData>>("web_search", {
      query,
      ...options,
    }),

  /**
   * Search news articles using Brave Search
   * @param query - News search query (required)
   * @param options - Optional parameters: count (1-20), freshness (24h/week/month)
   */
  newsSearch: (
    query: string,
    options?: {
      count?: number;
      freshness?: "24h" | "week" | "month";
    }
  ) =>
    callTool<StandardResponse<NewsSearchData>>("news_search", {
      query,
      ...options,
    }),

  /**
   * Call web_search with raw arguments (for testing invalid inputs)
   */
  webSearchRaw: (args: Record<string, unknown>) =>
    callTool<StandardResponse<WebSearchData>>("web_search", args),

  /**
   * Call news_search with raw arguments (for testing invalid inputs)
   */
  newsSearchRaw: (args: Record<string, unknown>) =>
    callTool<StandardResponse<NewsSearchData>>("news_search", args),
};

export { SEARCHER_URL };
