/**
 * Shared tool registration wrapper for McpServer.
 *
 * Provides project conventions on top of the SDK's registerTool():
 * - Handler returns StandardResponse, wrapper formats for MCP content
 * - Consistent error handling with StandardResponse on failures
 * - Tool annotations support
 */

import type { z } from 'zod';
import type { StandardResponse } from '../Types/StandardResponse.js';
import { createErrorFromException } from '../Types/StandardResponse.js';

/**
 * Structural interface for McpServer — avoids concrete class import
 * so that packages with different SDK versions still type-check.
 * Uses permissive `(...args: unknown[]) => unknown` so that any
 * SDK version's registerTool signature is assignable.
 */
interface McpServerLike {
  registerTool(...args: unknown[]): unknown;
}

/**
 * Tool annotations matching the MCP spec.
 */
interface ToolAnnotations extends Record<string, unknown> {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * Register a tool on McpServer with project conventions.
 *
 * The inputSchema should be a Zod object — its `.shape` is extracted for the SDK,
 * and the SDK validates input before calling the handler.
 *
 * Handler receives already-validated input and should return a StandardResponse.
 * The wrapper handles MCP content formatting and error wrapping.
 */
export function registerTool<T extends z.AnyZodObject>(
  server: McpServerLike,
  config: {
    name: string;
    description: string;
    inputSchema: T;
    annotations?: ToolAnnotations;
    handler: (input: z.infer<NoInfer<T>>) => Promise<StandardResponse>;
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
        // SDK validates args against inputSchema before calling this callback,
        // so the cast is safe — it's centralised here instead of at every call site.
        const result = await config.handler(args as z.infer<T>);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (error) {
        const errorResponse = createErrorFromException(error);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(errorResponse) }],
        };
      }
    }
  );
}
