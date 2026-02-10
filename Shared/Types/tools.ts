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
 * Validation error thrown when tool input fails schema validation.
 * Dispatch code can catch this to return a 400 response.
 */
export class ValidationError extends Error {
  constructor(public readonly zodError: z.ZodError) {
    super(`Invalid parameters: ${zodError.message}`);
    this.name = 'ValidationError';
  }
}

/**
 * Type-erased tool map entry for HTTP /tools/call dispatch.
 * `call` validates input via schema then invokes the handler — fully type-safe, no casts.
 */
export interface ToolMapEntry {
  call: (input: unknown) => Promise<unknown>;
  schema: z.ZodType;
}

/**
 * Create a type-safe ToolMapEntry.
 * Validation and handler call happen in the same generic scope where T is known,
 * so safeParse().data (T) flows directly into handler (T) — no cast needed.
 */
export function toolEntry<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  handler: (input: T) => Promise<unknown>
): ToolMapEntry {
  return {
    schema,
    call(input: unknown): Promise<unknown> {
      const result = schema.safeParse(input);
      if (!result.success) {
        throw new ValidationError(result.error);
      }
      return handler(result.data);
    }
  };
}
