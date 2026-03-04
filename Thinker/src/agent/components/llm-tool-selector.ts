/**
 * LLM Tool Selector — uses a local Qwen3.5-4B model via Ollama
 * to select the most appropriate tool from the full catalog.
 *
 * Wraps OllamaToolClient with:
 * - Circuit breaker for failure tracking
 * - Non-blocking auto-pull on initialization
 * - CoreTool → OllamaToolSchema conversion
 * - Tool name validation against available tools
 */

import type { CoreTool } from 'ai';
import { Logger } from '@mcp/shared/Utils/logger.js';
import { OllamaToolClient } from '../../llm/ollama-tool-client.js';
import type { OllamaToolSchema, ToolSelectionResult } from '../../llm/ollama-tool-client.js';
import { CircuitBreaker } from '../circuit-breaker.js';

const logger = new Logger('thinker:llm-tool-selector');

const SYSTEM_PROMPT = [
  'You are a tool-calling assistant with access to many tools.',
  'When the user asks something that requires action (searching, sending, reading files, storing info, etc.), call the most appropriate tool.',
  'You do NOT have access to real-time information. For weather, news, current events, scores, or any time-sensitive data, ALWAYS use a search tool.',
  'Pick exactly ONE tool — the most specific match. Do not call multiple tools.',
].join(' ');

export interface LlmToolSelectorConfig {
  host: string;
  model: string;
  timeoutMs: number;
  enabled: boolean;
}

/** Discriminated union for LLM tool selection outcomes */
export type LlmToolSelectionOutcome =
  | { kind: 'tool_selected'; toolName: string; args: Record<string, unknown> }
  | { kind: 'no_tool_needed' }

/** Name of the pseudo-tool the 4B can call to signal "no tool action required" */
export const NO_TOOL_NEEDED = '_No_Tool_Needed' as const;

const NO_TOOL_NEEDED_SCHEMA: OllamaToolSchema = {
  type: 'function',
  function: {
    name: NO_TOOL_NEEDED,
    description: [
      'Use when the user\'s message does not require any tool action —',
      'e.g., greetings (hello, hi, hey), thanks, goodbyes, opinions,',
      'general knowledge questions, or casual conversation.',
      'Do NOT use this if the user is requesting an action (send, create, read, save, delete,',
      'navigate, run, check, remind, etc.) or asking for real-time data',
      '(weather, news, scores, current events — use a search tool instead).',
    ].join(' '),
    parameters: { type: 'object', properties: {} },
  },
};

export class LlmToolSelector {
  private client: OllamaToolClient;
  private circuitBreaker: CircuitBreaker;
  private available = false;
  private enabled: boolean;
  private cachedSchemas: OllamaToolSchema[] = [];

  constructor(config: LlmToolSelectorConfig) {
    this.enabled = config.enabled;
    this.client = new OllamaToolClient(config.host, config.model, config.timeoutMs);
    // 3 consecutive failures → open for 5 minutes
    this.circuitBreaker = new CircuitBreaker(3, 5 * 60 * 1000);
  }

  /**
   * Initialize: health check + auto-pull model if missing.
   * Non-blocking — startup is never delayed by model download.
   */
  async initialize(): Promise<void> {
    if (!this.enabled) {
      logger.info('LLM tool selector disabled via config');
      return;
    }

    const healthy = await this.client.healthCheck();
    if (!healthy) {
      logger.warn('Ollama not reachable — LLM tool selector unavailable');
      return;
    }

    const modelReady = await this.client.isModelAvailable();
    if (modelReady) {
      this.available = true;
      logger.info('LLM tool selector ready');
      return;
    }

    // Model missing — pull in the background (non-blocking)
    logger.info('Model not found, pulling in background — using fallback until ready');
    this.client.pullModel().then((success) => {
      if (success) {
        this.available = true;
        logger.info('Model pulled — LLM tool selector now available');
      } else {
        logger.warn('Model pull failed — LLM tool selector remains unavailable');
      }
    }).catch((err) => {
      logger.error('Background model pull error:', err);
    });
  }

  /** Whether the selector is ready to accept requests */
  isAvailable(): boolean {
    return this.enabled && this.available && this.circuitBreaker.canProcess();
  }

  /**
   * Build and cache tool schemas from the CoreTool map.
   * Call this after tools are discovered/refreshed.
   */
  updateToolSchemas(tools: Record<string, CoreTool>): void {
    this.cachedSchemas = convertToOllamaSchemas(tools);
    logger.info(`Cached ${this.cachedSchemas.length} tool schemas for LLM selector`);
  }

  /**
   * Select the first tool for a message using the local LLM.
   *
   * Returns a discriminated union:
   * - `{ kind: 'tool_selected', toolName, args }` — LLM picked a real tool
   * - `{ kind: 'no_tool_needed' }` — LLM explicitly chose _No_Tool_Needed
   * - `null` — unavailable, error, ambiguous (no tool call at all), or invalid tool name
   */
  async selectFirstTool(
    message: string,
    allTools: Record<string, CoreTool>,
  ): Promise<LlmToolSelectionOutcome | null> {
    if (!this.isAvailable()) {
      return null;
    }

    if (this.cachedSchemas.length === 0) {
      this.updateToolSchemas(allTools);
    }

    // Append _No_Tool_Needed so the 4B can explicitly signal "no action required"
    const schemasWithNoTool = [...this.cachedSchemas, NO_TOOL_NEEDED_SCHEMA];

    try {
      const result = await this.client.selectTool(message, schemasWithNoTool, SYSTEM_PROMPT);

      if (!result) {
        // LLM made no tool call at all — ambiguous, let full pipeline handle it
        this.circuitBreaker.recordSuccess();
        logger.info('LLM selector: no tool call (ambiguous)');
        return null;
      }

      // Check for explicit "no tool needed" signal
      if (result.toolName === NO_TOOL_NEEDED) {
        this.circuitBreaker.recordSuccess();
        logger.info('LLM selector: _No_Tool_Needed (core-only)');
        return { kind: 'no_tool_needed' };
      }

      // Validate tool name exists
      if (!allTools[result.toolName]) {
        logger.warn(`LLM selector returned unknown tool '${result.toolName}' — ignoring`);
        this.circuitBreaker.recordSuccess(); // Not a system failure
        return null;
      }

      this.circuitBreaker.recordSuccess();
      logger.info(`LLM selector: ${result.toolName}`);
      return { kind: 'tool_selected', toolName: result.toolName, args: result.args };
    } catch (error) {
      this.circuitBreaker.recordFailure();
      logger.warn('LLM selector failed, falling back:', error);

      // If circuit breaker just tripped, mark as unavailable
      if (this.circuitBreaker.getState().state === 'open') {
        logger.error('LLM selector circuit breaker tripped — disabling until cooldown');
      }

      return null;
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Convert Vercel AI SDK CoreTool map to Ollama/OpenAI tool schemas.
 *
 * CoreTool stores parameters as a Zod schema or a jsonSchema wrapper.
 * We extract the raw JSON Schema for the Ollama API.
 */
function convertToOllamaSchemas(tools: Record<string, CoreTool>): OllamaToolSchema[] {
  const schemas: OllamaToolSchema[] = [];

  for (const [name, t] of Object.entries(tools)) {
    // CoreTool has type: 'function', description, and parameters
    // The parameters field has a jsonSchema property with the raw JSON Schema
    const coreTool = t as Record<string, unknown>;
    const description = (coreTool.description ?? '') as string;

    let parameters: Record<string, unknown> = { type: 'object', properties: {} };
    const params = coreTool.parameters as Record<string, unknown> | undefined;
    if (params) {
      // Vercel AI SDK wraps JSON Schema in a { jsonSchema: {...} } object
      if (params.jsonSchema && typeof params.jsonSchema === 'object') {
        parameters = params.jsonSchema as Record<string, unknown>;
      } else if (params.type === 'object') {
        // Already raw JSON Schema
        parameters = params;
      }
    }

    schemas.push({
      type: 'function',
      function: { name, description, parameters },
    });
  }

  return schemas;
}
