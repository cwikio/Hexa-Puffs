import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { allTools } from "./tools/index.js";
import { logger } from "./utils/logger.js";
import type { StandardResponse } from "./types/responses.js";

export function createServer(): Server {
  const server = new Server(
    {
      name: "gmail-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug("Listing tools", { count: allTools.length });
    return {
      tools: allTools.map(({ tool }) => tool),
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logger.info("Tool called", { name });

    const toolEntry = allTools.find(({ tool }) => tool.name === name);
    if (!toolEntry) {
      logger.warn("Unknown tool called", { name });
      const response: StandardResponse = {
        success: false,
        error: `Unknown tool: ${name}`,
      };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
        isError: true,
      };
    }

    try {
      const output = await toolEntry.handler(args ?? {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(output, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error("Tool call failed", { name, error });
      const response: StandardResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

export async function initializeServer(): Promise<Server> {
  logger.info("Initializing Gmail MCP server");
  return createServer();
}
