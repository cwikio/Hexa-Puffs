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
  newsSearchSchema,
  handleNewsSearch,
  imageSearchSchema,
  handleImageSearch,
  webFetchSchema,
  handleWebFetch,
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
      const result = await handleWebSearch(params);
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
      const result = await handleNewsSearch(params);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "image_search",
    description:
      "Search for images on the web. Returns direct image URLs and thumbnails. Use for finding photos, pictures, or visual content.\n\nArgs:\n  - query (string): Image search query\n  - count (number, optional): Number of results, 1-20 (default: 5)\n  - safesearch (string, optional): 'off', 'moderate', or 'strict' (default: 'moderate')\n\nReturns: { results: [{ title, source_url, image_url, thumbnail_url, source }], total_count, query }",
    inputSchema: imageSearchSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (params) => {
      const result = await handleImageSearch(params);
      return createSuccess(result);
    },
  });

  registerTool(server, {
    name: "web_fetch",
    description:
      "Fetch a URL and extract its content as clean markdown. PREFERRED over browser tools for reading webpage content — much faster and more reliable. Uses Readability to extract article content (strips nav, ads, sidebars). Use this whenever you need to read or summarize a webpage. Only fall back to browser tools if you need to interact with the page (click, scroll, fill forms, login) or if this tool returns empty/unusable content.\n\nArgs:\n  - url (string): The URL to fetch\n  - maxLength (number, optional): Max chars to return (default: 20000)\n  - includeLinks (boolean, optional): Preserve hyperlinks in markdown (default: true)\n  - timeout (number, optional): Fetch timeout in ms (default: 10000)\n\nReturns: { url, title, content, contentLength, truncated }",
    inputSchema: webFetchSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (params) => {
      const result = await handleWebFetch(params);
      return createSuccess(result);
    },
  });

  return server;
}
