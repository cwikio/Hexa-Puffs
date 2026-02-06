/**
 * Searcher MCP Server
 * Provides web and news search tools using Brave Search API
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { StandardResponse } from "./types/shared.js";
import {
  webSearchSchema,
  handleWebSearch,
  newsSearchSchema,
  handleNewsSearch,
} from "./tools/index.js";

type ZodSchema = z.ZodObject<z.ZodRawShape>;

export function createServer(): McpServer {
  const server = new McpServer({
    name: "searcher",
    version: "1.0.0",
  });

  // Helper to wrap tool handlers with standard error handling
  function registerTool<T>(
    name: string,
    description: string,
    schema: ZodSchema,
    handler: (input: T) => Promise<unknown>
  ): void {
    server.tool(name, description, schema.shape, async (params) => {
      // If params is undefined, default to empty object
      const safeParams = params === undefined ? {} : params;
      const result = schema.safeParse(safeParams);

      if (!result.success) {
        const response: StandardResponse = {
          success: false,
          error: `Invalid parameters: ${result.error.message}`,
        };
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(response),
            },
          ],
        };
      }

      try {
        const output = await handler(result.data as T);
        const response: StandardResponse<unknown> = {
          success: true,
          data: output,
        };
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(response),
            },
          ],
        };
      } catch (error) {
        const response: StandardResponse = {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(response),
            },
          ],
        };
      }
    });
  }

  // Register search tools
  registerTool(
    "web_search",
    "Search the web using Brave Search. Returns titles, URLs, and descriptions.",
    webSearchSchema,
    handleWebSearch
  );

  registerTool(
    "news_search",
    "Search news articles using Brave Search. Returns recent news with sources.",
    newsSearchSchema,
    handleNewsSearch
  );

  return server;
}
