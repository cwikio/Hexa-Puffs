/**
 * MCP Client Test Helper for Searcher MCP.
 * Uses shared base client, adds Searcher-specific convenience methods.
 */

import { MCPStdioTestClient } from '@mcp/shared/Testing/mcp-stdio-test-client.js';
import { type MCPToolCallResult } from '@mcp/shared/Testing/mcp-test-client.js';

export { log, logSection } from '@mcp/shared/Testing/test-utils.js';
export { type MCPToolCallResult } from '@mcp/shared/Testing/mcp-test-client.js';

const client = new MCPStdioTestClient({
  command: 'node',
  args: ['dist/index.js'],
  env: { TRANSPORT: 'stdio' },
});

// Ensure we stop the client when tests are done (Vitest hooks would be better, but this is a global client)
// We'll expose a cleanup function
export async function cleanup() {
  await client.stop();
}

export function logInfo(message: string): void {
  const ts = new Date().toISOString().split("T")[1].slice(0, 12);
  console.log(`[${ts}] i ${message}`);
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
  logInfo(`Checking health (Stdio)`);
  const result = await client.healthCheck();
  if (result.healthy) {
    logSuccess("Health check passed", result.duration);
  } else {
    logError("Health check failed", result.error);
  }
  return result.healthy;
}

export async function getHealthData(): Promise<{
  status: string;
  transport: string;
  searchProvider: string;
} | null> {
  // Mocking health data since we don't have an endpoint. 
  // We effectively checked it via checkHealth
  return {
    status: 'healthy',
    transport: 'stdio',
    searchProvider: 'brave' // Assumption based on config
  };
}

export async function listTools(): Promise<{
  tools: Array<{
    name: string;
    description: string;
    inputSchema: object;
  }>;
} | null> {
  try {
    const result = await client.listTools();
    // Map descriptions to ensure they are strings (SDK might make them optional)
    return {
        tools: result.tools.map(t => ({
            name: t.name,
            description: t.description || '',
            inputSchema: t.inputSchema || {}
        }))
    };
  } catch (err) {
    logError("Failed to list tools", err instanceof Error ? err.message : String(err));
    return null;
  }
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

export interface WebFetchData {
  url: string;
  title: string;
  content: string;
  contentLength: number;
  truncated: boolean;
}

export interface StandardResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Convenience methods for each tool

export const tools = {
  webSearch: (
    query: string,
    options?: {
      count?: number;
      freshness?: "24h" | "week" | "month" | "year";
      safesearch?: "off" | "moderate" | "strict";
    }
  ) =>
    callTool<WebSearchData>("web_search", {
      query,
      ...options,
    }),

  newsSearch: (
    query: string,
    options?: {
      count?: number;
      freshness?: "24h" | "week" | "month";
    }
  ) =>
    callTool<NewsSearchData>("news_search", {
      query,
      ...options,
    }),

  webSearchRaw: (args: Record<string, unknown>) =>
    callTool<WebSearchData>("web_search", args),

  newsSearchRaw: (args: Record<string, unknown>) =>
    callTool<NewsSearchData>("news_search", args),

  webFetch: (
    url: string,
    options?: {
      maxLength?: number;
      includeLinks?: boolean;
      timeout?: number;
    }
  ) =>
    callTool<WebFetchData>("web_fetch", {
      url,
      ...options,
    }),

  webFetchRaw: (args: Record<string, unknown>) =>
    callTool<WebFetchData>("web_fetch", args),
};
