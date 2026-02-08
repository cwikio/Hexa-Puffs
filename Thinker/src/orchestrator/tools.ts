import { tool } from 'ai';
import { z } from 'zod';
import type { CoreTool } from 'ai';
import type { OrchestratorClient } from './client.js';
import type { OrchestratorTool } from './types.js';
import type { TraceContext } from '../tracing/types.js';
import { getTraceLogger } from '../tracing/logger.js';

/**
 * Convert JSON Schema property to Zod schema
 * This is a simplified converter for common types
 */
function jsonSchemaToZod(property: unknown): z.ZodTypeAny {
  if (!property || typeof property !== 'object') {
    return z.unknown();
  }

  const prop = property as Record<string, unknown>;
  const type = prop.type as string | undefined;
  const description = prop.description as string | undefined;

  let schema: z.ZodTypeAny;

  switch (type) {
    case 'string':
      if (prop.enum && Array.isArray(prop.enum)) {
        schema = z.enum(prop.enum as [string, ...string[]]);
      } else {
        schema = z.string();
      }
      break;
    case 'number':
    case 'integer':
      schema = z.number();
      break;
    case 'boolean':
      schema = z.boolean();
      break;
    case 'array':
      const items = prop.items;
      schema = z.array(jsonSchemaToZod(items));
      break;
    case 'object':
      const properties = prop.properties as Record<string, unknown> | undefined;
      if (properties) {
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const [key, value] of Object.entries(properties)) {
          shape[key] = jsonSchemaToZod(value);
        }
        schema = z.object(shape);
      } else {
        schema = z.record(z.unknown());
      }
      break;
    default:
      schema = z.unknown();
  }

  if (description) {
    schema = schema.describe(description);
  }

  return schema;
}

/**
 * Convert Orchestrator tool definition to Zod schema
 * Uses preprocess to handle null/undefined args (LLMs sometimes pass null for no-arg tools)
 */
function orchestratorToolToZodSchema(
  tool: OrchestratorTool
): z.ZodTypeAny {
  const properties = tool.inputSchema.properties || {};
  const required = tool.inputSchema.required || [];

  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, value] of Object.entries(properties)) {
    let propSchema = jsonSchemaToZod(value);

    // Make optional if not required
    if (!required.includes(key)) {
      propSchema = propSchema.nullish();
    }

    shape[key] = propSchema;
  }

  // Preprocess to convert null/undefined to empty object (LLMs often pass null for tools with no params)
  return z.preprocess(
    (val) => (val === null || val === undefined ? {} : val),
    z.object(shape)
  );
}

/**
 * Create Vercel AI SDK tools from Orchestrator tools
 */
export function createToolsFromOrchestrator(
  orchestratorTools: OrchestratorTool[],
  client: OrchestratorClient,
  getTrace: () => TraceContext | undefined
): Record<string, CoreTool> {
  const tools: Record<string, CoreTool> = {};
  const logger = getTraceLogger();

  for (const orchTool of orchestratorTools) {
    // Skip some internal tools that shouldn't be exposed to LLM
    if (orchTool.name.startsWith('_') || orchTool.name === 'health') {
      continue;
    }

    const zodSchema = orchestratorToolToZodSchema(orchTool);

    const wrappedTool = tool({
      description: orchTool.description,
      parameters: zodSchema,
      execute: async (args) => {
        // Normalize null/undefined args to empty object (for tools with no parameters)
        const normalizedArgs = (args ?? {}) as Record<string, unknown>;
        const trace = getTrace();
        const startTime = Date.now();

        if (trace) {
          await logger.logToolCallStart(trace, orchTool.name, normalizedArgs);
        }

        try {
          const result = await client.executeTool(
            orchTool.name,
            normalizedArgs,
            trace
          );

          const durationMs = Date.now() - startTime;

          if (trace) {
            await logger.logToolCallComplete(trace, orchTool.name, result.success, durationMs);
          }

          if (!result.success) {
            throw new Error(result.error || 'Tool execution failed');
          }

          return result.result;
        } catch (error) {
          if (trace) {
            await logger.logToolCallError(
              trace,
              orchTool.name,
              error instanceof Error ? error.message : 'Unknown error'
            );
          }
          throw error;
        }
      },
    });

    tools[orchTool.name] = wrappedTool;
  }

  return tools;
}

/**
 * Create essential tools that are always available
 * These are hardcoded tools for core functionality
 */
export function createEssentialTools(
  client: OrchestratorClient,
  agentId: string,
  getTrace: () => TraceContext | undefined,
): Record<string, CoreTool> {
  const logger = getTraceLogger();

  return {
    send_telegram: tool({
      description: 'Send a message to a Telegram chat',
      parameters: z.object({
        chat_id: z.string().describe('The Telegram chat ID to send to'),
        message: z.string().describe('The message text to send'),
        reply_to: z.number().optional().describe('Optional message ID to reply to'),
      }),
      execute: async ({ chat_id, message, reply_to }) => {
        const trace = getTrace();
        const startTime = Date.now();

        if (trace) {
          await logger.logToolCallStart(trace, 'send_telegram', { chat_id, message_length: message.length });
        }

        const success = await client.sendTelegramMessage(chat_id, message, reply_to, trace);
        const durationMs = Date.now() - startTime;

        if (trace) {
          await logger.logToolCallComplete(trace, 'send_telegram', success, durationMs);
        }

        return { success, message: success ? 'Message sent' : 'Failed to send message' };
      },
    }),

    store_fact: tool({
      description: 'Store a fact or learning about the user in memory',
      parameters: z.object({
        fact: z.string().describe('The fact to store'),
        category: z
          .enum(['preference', 'background', 'pattern', 'project', 'contact', 'decision'])
          .describe('Category of the fact'),
      }),
      execute: async ({ fact, category }) => {
        const trace = getTrace();
        const success = await client.storeFact(agentId, fact, category, trace);
        return { success, message: success ? 'Fact stored' : 'Failed to store fact' };
      },
    }),

    search_memories: tool({
      description: 'Search for relevant memories and past conversations',
      parameters: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().optional().default(5).describe('Maximum results to return'),
      }),
      execute: async ({ query, limit }) => {
        const trace = getTrace();
        const result = await client.retrieveMemories(agentId, query, limit, trace);
        return {
          facts: result.facts.map((f) => ({ fact: f.fact, category: f.category })),
          conversations: result.conversations.map((c) => ({
            user: c.user_message,
            assistant: c.agent_response,
          })),
        };
      },
    }),
  };
}
