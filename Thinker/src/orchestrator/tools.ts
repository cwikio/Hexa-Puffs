import { tool, jsonSchema } from 'ai';
import { z } from 'zod';
import type { CoreTool } from 'ai';
import type { OrchestratorClient } from './client.js';
import type { OrchestratorTool } from './types.js';
import type { TraceContext } from '../tracing/types.js';
import { getTraceLogger } from '../tracing/logger.js';

/**
 * Relax numeric types in JSON Schema to accept both numbers and strings.
 * Smaller LLMs (e.g. Llama on Groq) often stringify numbers in tool calls
 * (e.g. `"count": "5"` instead of `"count": 5`). The downstream MCP tools
 * handle coercion via `z.coerce.number()`, so this is safe.
 */
function relaxNumericTypes(schema: Record<string, unknown>): Record<string, unknown> {
  const relaxed = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;

  function walk(obj: Record<string, unknown>) {
    if (obj.type === 'number' || obj.type === 'integer') {
      obj.type = [obj.type as string, 'string'];
    }
    if (obj.properties && typeof obj.properties === 'object') {
      for (const prop of Object.values(obj.properties as Record<string, Record<string, unknown>>)) {
        if (prop && typeof prop === 'object') walk(prop);
      }
    }
    if (obj.items && typeof obj.items === 'object') {
      walk(obj.items as Record<string, unknown>);
    }
  }

  walk(relaxed);
  return relaxed;
}

/**
 * Create Vercel AI SDK tools from Orchestrator tools.
 *
 * Uses `jsonSchema()` to pass the MCP's original JSON Schema directly to the
 * AI SDK, avoiding a lossy JSON Schema → Zod → JSON Schema roundtrip that
 * was stripping type information from tool parameters (e.g. `"query":{}` instead
 * of `"query":{"type":"string"}`), which caused Groq/Maverick to intermittently
 * output tool calls as text instead of using the structured tool_calls API.
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

    // Pass the MCP's original JSON Schema directly — no lossy Zod conversion
    // Relax numeric types so smaller LLMs can pass "5" instead of 5
    const schema = jsonSchema(relaxNumericTypes(orchTool.inputSchema));

    const wrappedTool = tool({
      description: orchTool.description,
      parameters: schema,
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
            // Return error as a tool result so the LLM can see it and adapt
            // (e.g. retry with correct parameters, or explain to the user)
            return { error: result.error || 'Tool execution failed', success: false };
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
