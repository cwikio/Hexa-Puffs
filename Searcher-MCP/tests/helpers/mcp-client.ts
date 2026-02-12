/**
 * MCP Client Test Helper for Searcher MCP.
 * Uses shared base client, adds Searcher-specific convenience methods.
 */

import { MCPTestClient, resolveToken, type MCPToolCallResult } from '@mcp/shared/Testing/mcp-test-client.js';
export { log, logSection } from '@mcp/shared/Testing/test-utils.js';
export { type MCPToolCallResult } from '@mcp/shared/Testing/mcp-test-client.js';

export const SEARCHER_URL = process.env.SEARCHER_URL || "http://localhost:8007";

const client = new MCPTestClient('Searcher', SEARCHER_URL);

/** Auth headers for raw fetch calls that bypass MCPTestClient */
export function authHeaders(): Record<string, string> {
  const token = resolveToken();
  if (token) return { 'X-Annabelle-Token': token };
  return {};
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
  logInfo(`Checking health at ${SEARCHER_URL}/health`);
  const result = await client.healthCheck();
  if (result.healthy) {
    logSuccess("Health check passed", result.duration);
  } else {
    logError("Health check failed", result.error || `Status ${result.status}`);
  }
  return result.healthy;
}

export async function getHealthData(): Promise<{
  status: string;
  transport: string;
  searchProvider: string;
} | null> {
  try {
    const response = await fetch(`${SEARCHER_URL}/health`, { headers: authHeaders() });
    if (response.ok) {
      return response.json();
    }
    return null;
  } catch {
    return null;
  }
}

export async function listTools(): Promise<{
  tools: Array<{
    name: string;
    description: string;
    inputSchema: object;
  }>;
} | null> {
  try {
    const response = await fetch(`${SEARCHER_URL}/tools/list`, { headers: authHeaders() });
    if (response.ok) {
      return response.json();
    }
    return null;
  } catch {
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
