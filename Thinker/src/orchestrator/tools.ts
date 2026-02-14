import { tool, jsonSchema } from 'ai';
import { z } from 'zod';
import type { CoreTool } from 'ai';
import type { OrchestratorClient } from './client.js';
import type { OrchestratorTool } from './types.js';
import type { TraceContext } from '../tracing/types.js';
import { getTraceLogger } from '../tracing/logger.js';

/**
 * Relax numeric and boolean types in JSON Schema to also accept strings.
 * Smaller LLMs (e.g. Llama on Groq) often stringify primitives in tool calls
 * (e.g. `"count": "5"` instead of `"count": 5`, `"clear": "true"` instead of
 * `"clear": true`). The downstream MCP tools handle numeric coercion via
 * `z.coerce.number()`. Boolean coercion is handled by `coerceStringBooleans()`
 * in the execute callback before args are sent to the Orchestrator.
 */
export function relaxSchemaTypes(schema: Record<string, unknown>): Record<string, unknown> {
  const relaxed = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;

  function walk(obj: Record<string, unknown>, requiredKeys?: Set<string>) {
    if (obj.type === 'number' || obj.type === 'integer' || obj.type === 'boolean') {
      obj.type = [obj.type as string, 'string'];
    }
    if (obj.properties && typeof obj.properties === 'object') {
      const required = new Set(
        Array.isArray(obj.required) ? (obj.required as string[]) : [],
      );
      for (const [key, prop] of Object.entries(
        obj.properties as Record<string, Record<string, unknown>>,
      )) {
        if (prop && typeof prop === 'object') {
          // Recurse first so numeric/boolean relaxation runs on the original type
          walk(prop);
          // Then allow null for optional properties — LLMs send null instead of omitting
          if (!required.has(key)) {
            if (typeof prop.type === 'string') {
              prop.type = [prop.type, 'null'];
            } else if (Array.isArray(prop.type) && !prop.type.includes('null')) {
              prop.type = [...prop.type, 'null'];
            }
          }
        }
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
 * Coerce string booleans ("true"/"false") to actual booleans in tool call args.
 * Needed because Groq/Llama often sends `"true"` instead of `true` for boolean params.
 * Mutates the args object in-place.
 */
function coerceStringBooleans(args: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(args)) {
    if (value === 'true') args[key] = true;
    else if (value === 'false') args[key] = false;
  }
  return args;
}

/**
 * Strip null values from tool call args.
 * LLMs (especially Llama on Groq) send `null` for optional params instead of omitting them.
 * `relaxSchemaTypes` lets nulls pass JSON Schema validation; this cleans them before
 * sending to the Orchestrator/MCP where Zod schemas use `.optional()` (not `.nullish()`).
 * Mutates the args object in-place.
 */
export function stripNullValues(args: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(args)) {
    if (value === null) delete args[key];
  }
  return args;
}

/**
 * Parameters to strip from specific tool prefixes.
 * LLMs (especially Llama 3.3) hallucinate values for optional params like teamId/slug
 * in Vercel tools, causing 403 Forbidden errors. The API token handles scoping
 * automatically — these params are never needed for personal accounts.
 * Mutates the args object in-place.
 */
const STRIP_PARAMS: Record<string, string[]> = {
  vercel_: ['teamId', 'slug'],
};

function stripHallucinatedParams(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  for (const [prefix, params] of Object.entries(STRIP_PARAMS)) {
    if (toolName.startsWith(prefix)) {
      for (const param of params) {
        delete args[param];
      }
      break;
    }
  }
  return args;
}

/**
 * Max length for a valid Telegram chat_id. Real IDs are numeric strings (< 15 chars).
 * Anything longer is likely a hallucinated placeholder like "the user's chat id or username".
 */
const MAX_CHAT_ID_LENGTH = 20;

/**
 * Auto-inject or fix chat_id for telegram_send_message tool calls.
 * LLMs (especially Llama/Groq in proactive tasks) hallucinate placeholder
 * chat_ids like "the user's chat id or username" or "@username".
 * The known primary chat_id is injected from the channel manager.
 * Mutates the args object in-place.
 */
export function injectChatId(
  toolName: string,
  args: Record<string, unknown>,
  chatId: string | undefined,
): Record<string, unknown> {
  if (toolName !== 'telegram_send_message' || !chatId) return args;

  const current = args.chat_id;
  if (!current || typeof current !== 'string' || current.length > MAX_CHAT_ID_LENGTH) {
    args.chat_id = chatId;
  }
  return args;
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
  getTrace: () => TraceContext | undefined,
  getChatId: () => string | undefined,
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
    const schema = jsonSchema(relaxSchemaTypes(orchTool.inputSchema));

    const wrappedTool = tool({
      description: orchTool.description,
      parameters: schema,
      execute: async (args) => {
        // Normalize null/undefined args to empty object (for tools with no parameters)
        // Coerce string booleans from Groq/Llama ("true"→true, "false"→false)
        // Strip hallucinated params (e.g. teamId/slug from vercel_ tools)
        // Auto-inject chat_id for telegram_send_message when missing or hallucinated
        const normalizedArgs = injectChatId(
          orchTool.name,
          stripHallucinatedParams(
            orchTool.name,
            stripNullValues(coerceStringBooleans((args ?? {}) as Record<string, unknown>))
          ),
          getChatId(),
        );
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
  getChatId: () => string | undefined,
): Record<string, CoreTool> {
  const logger = getTraceLogger();

  return {
    send_telegram: tool({
      description: 'Send a message to a Telegram chat. The chat_id is auto-injected if omitted.',
      parameters: z.object({
        chat_id: z.string().optional().describe('The Telegram chat ID (auto-injected if omitted)'),
        message: z.string().describe('The message text to send'),
        reply_to: z.number().nullish().describe('Optional message ID to reply to'),
      }),
      execute: async ({ chat_id, message, reply_to }) => {
        // Auto-inject chat_id from known primary chat when missing
        const resolvedChatId = chat_id || getChatId();
        if (!resolvedChatId) {
          return { success: false, message: 'No chat_id provided and no primary chat available' };
        }

        const trace = getTrace();
        const startTime = Date.now();

        if (trace) {
          await logger.logToolCallStart(trace, 'send_telegram', { chat_id: resolvedChatId, message_length: message.length });
        }

        const success = await client.sendTelegramMessage(resolvedChatId, message, reply_to ?? undefined, trace);
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
