/**
 * Shared tool definition types for MCP services
 */

import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/**
 * Standard MCP tool definition format
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  annotations?: ToolAnnotations;
}

/**
 * Generic tool handler function type
 */
export type ToolHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput
) => Promise<TOutput>;

/**
 * Tool entry combining definition and handler
 * Useful for creating tool registries
 */
export interface ToolEntry<TInput = unknown, TOutput = unknown> {
  tool: ToolDefinition;
  handler: ToolHandler<TInput, TOutput>;
}
