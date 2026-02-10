/**
 * Shared tool definition types for MCP services
 */

import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';

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

/**
 * Type-erased tool map entry for HTTP /tools/call dispatch.
 * Handler accepts unknown because dispatch code validates via schema.safeParse() first.
 */
export interface ToolMapEntry {
  handler: (input: unknown) => Promise<unknown>;
  schema: z.ZodType;
}

/**
 * Create a type-safe ToolMapEntry — ensures handler input matches schema output at compile time.
 * Cast is safe because dispatch code runs schema.safeParse() before calling handler().
 */
export function toolEntry<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  handler: (input: T) => Promise<unknown>
): ToolMapEntry {
  return { schema, handler: handler as (input: unknown) => Promise<unknown> };
}
