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
      "Search the web for current information, facts, documentation, or any topic. Returns titles, URLs, and descriptions. Use freshness to filter by recency: '24h' for today's info, 'week' for this week, 'month' for this month. Do NOT use this for questions you can answer from your own knowledge.",
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
      "Search recent news articles. Use this instead of web_search when the user asks about current events, breaking news, or recent developments. Returns headlines, sources, and publication dates.",
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
