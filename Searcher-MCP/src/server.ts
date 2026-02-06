/**
 * Searcher MCP Server
 * Provides web and news search tools using Brave Search API
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool } from "@mcp/shared/Utils/register-tool.js";
import { createSuccess } from "@mcp/shared/Types/StandardResponse.js";
import {
  webSearchSchema,
  handleWebSearch,
  type WebSearchInput,
  newsSearchSchema,
  handleNewsSearch,
  type NewsSearchInput,
} from "./tools/index.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "searcher",
    version: "1.0.0",
  });

  registerTool(server, {
    name: "web_search",
    description:
      "Search the web for current information, documentation, or any topic. Do NOT use for questions answerable from your own knowledge.\n\nArgs:\n  - query (string): Search query\n  - count (number, optional): Number of results, 1-20 (default: 10)\n  - freshness (string, optional): Recency filter — '24h', 'week', 'month', or 'year'\n  - safesearch (string, optional): 'off', 'moderate', or 'strict' (default: 'moderate')\n\nReturns: { results: [{ title, url, description, age? }], total_count, query }",
    inputSchema: webSearchSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (params) => {
      const result = await handleWebSearch(params as WebSearchInput);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "news_search",
    description:
      "Search recent news articles. Use instead of web_search for current events, breaking news, or recent developments.\n\nArgs:\n  - query (string): Search query\n  - count (number, optional): Number of results, 1-20 (default: 10)\n  - freshness (string, optional): Recency filter — '24h', 'week', 'month'\n\nReturns: { results: [{ title, url, description, age?, source? }], total_count, query }",
    inputSchema: newsSearchSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (params) => {
      const result = await handleNewsSearch(params as NewsSearchInput);
      return createSuccess(result);
    },
  });

  return server;
}
