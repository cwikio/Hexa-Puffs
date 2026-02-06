import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { allTools } from "./tools/index.js";
import type { StandardResponse } from "./types/shared.js";

export function createServer(): Server {
  const server = new Server(
    {
      name: "telegram-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: allTools.map(({ tool }) => tool),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const toolEntry = allTools.find(({ tool }) => tool.name === name);
    if (!toolEntry) {
      throw new Error(`Unknown tool: ${name}`);
    }

    try {
      const output = await toolEntry.handler(args || {});
      const response: StandardResponse<unknown> = {
        success: true,
        data: output,
      };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    } catch (error) {
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
