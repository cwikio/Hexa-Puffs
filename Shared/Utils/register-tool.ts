/**
 * Shared tool registration wrapper for McpServer.
 *
 * Provides project conventions on top of the SDK's registerTool():
 * - Handler returns StandardResponse, wrapper formats for MCP content
 * - Consistent error handling with StandardResponse on failures
 * - SDK handles Zod validation internally (no manual safeParse needed)
 * - Tool annotations support
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { StandardResponse } from '../Types/StandardResponse.js';

/**
 * Register a tool on McpServer with project conventions.
 *
 * The inputSchema should be a Zod object — its `.shape` is extracted for the SDK,
 * and the SDK validates input before calling the handler.
 *
 * Handler receives already-validated input and should return a StandardResponse.
 * The wrapper handles MCP content formatting and error wrapping.
 */
export function registerTool(
  server: McpServer,
  config: {
    name: string;
    description: string;
    inputSchema: z.AnyZodObject;
    annotations?: ToolAnnotations;
    handler: (input: Record<string, unknown>) => Promise<StandardResponse>;
  }
): void {
  server.registerTool(
    config.name,
    {
      description: config.description,
      inputSchema: config.inputSchema.shape,
      annotations: config.annotations,
    },
    async (args: Record<string, unknown>) => {
      try {
        const result = await config.handler(args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (error) {
        const errorResponse: StandardResponse = {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(errorResponse) }],
        };
      }
    }
  );
}
