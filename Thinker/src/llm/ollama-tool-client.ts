/**
 * Ollama API client for LLM-based tool selection.
 *
 * Uses Ollama's OpenAI-compatible /v1/chat/completions endpoint
 * with native tool calling. Follows the Guardian pattern (raw fetch).
 */

import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('thinker:ollama-tool-client');

// ── Types ───────────────────────────────────────────────────────

export interface OllamaToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface ToolCallResponse {
  function: {
    name: string;
    arguments: string;
  };
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCallResponse[];
    };
    finish_reason: string;
  }>;
}

interface OllamaTagsResponse {
  models?: Array<{
    name: string;
    modified_at: string;
    size: number;
  }>;
}

export interface ToolSelectionResult {
  toolName: string;
  args: Record<string, unknown>;
}

// ── Client ──────────────────────────────────────────────────────

export class OllamaToolClient {
  constructor(
    private readonly host: string,
    private readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  /** Check if Ollama is running and accessible */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.host}/api/tags`, {
        signal: AbortSignal.timeout(3_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Check if the specified model is available */
  async isModelAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.host}/api/tags`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as OllamaTagsResponse;
      const prefix = this.model.split(':')[0];
      return data.models?.some((m) => m.name.startsWith(prefix)) ?? false;
    } catch {
      return false;
    }
  }

  /** Pull the model (blocking). Returns true on success. */
  async pullModel(): Promise<boolean> {
    try {
      logger.info(`Pulling model ${this.model}...`);
      const res = await fetch(`${this.host}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: this.model, stream: false }),
        signal: AbortSignal.timeout(10 * 60 * 1000), // 10 min for download
      });
      if (res.ok) {
        logger.info(`Model ${this.model} pulled successfully`);
        return true;
      }
      const body = await res.text().catch(() => '');
      logger.error(`Failed to pull model ${this.model}: ${res.status} ${body}`);
      return false;
    } catch (error) {
      logger.error(`Error pulling model ${this.model}:`, error);
      return false;
    }
  }

  /**
   * Send a message with tool schemas and get the model's tool selection.
   * Returns null if the model chose not to call any tool.
   */
  async selectTool(
    message: string,
    tools: OllamaToolSchema[],
    systemPrompt: string,
  ): Promise<ToolSelectionResult | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.host}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ],
          tools,
          tool_choice: 'auto',
          temperature: 0.1,
          max_tokens: 512,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Ollama ${res.status}: ${body}`);
      }

      const data = (await res.json()) as ChatCompletionResponse;
      const toolCalls = data.choices[0]?.message?.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        return null;
      }

      const first = toolCalls[0];
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(first.function.arguments) as Record<string, unknown>;
      } catch {
        // Malformed args — return tool name with empty args
      }

      return { toolName: first.function.name, args };
    } finally {
      clearTimeout(timeout);
    }
  }
}
