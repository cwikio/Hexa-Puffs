import { Agent } from 'http';
import { type MCPServerConfig } from '../config/index.js';
import { MCPClientError, MCPUnavailableError } from '../utils/errors.js';
import { Logger, logger } from '@mcp/shared/Utils/logger.js';
import type {
  IMCPClient,
  MCPToolCall,
  MCPToolDefinition,
  ToolCallResult,
} from './types.js';

// Re-export types for backwards compatibility
export type { MCPToolCall, MCPToolDefinition, ToolCallResult } from './types.js';

/** HTTP keep-alive agent shared across all BaseMCPClient instances */
const keepAliveAgent = new Agent({ keepAlive: true, maxSockets: 10, keepAliveMsecs: 30_000 });

/** Check if an error is transient and worth retrying */
function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return true;
    const msg = error.message.toLowerCase();
    if (msg.includes('econnrefused') || msg.includes('econnreset') || msg.includes('epipe') || msg.includes('fetch failed')) return true;
  }
  if (error instanceof MCPClientError) {
    const details = error.details as Record<string, unknown> | undefined;
    if (details?.status) {
      const status = details.status as number;
      return status === 502 || status === 503 || status === 504;
    }
  }
  return false;
}

export abstract class BaseMCPClient implements IMCPClient {
  protected config: MCPServerConfig;
  protected logger: Logger;
  protected available: boolean = false;
  private readonly token: string | undefined = process.env.ANNABELLE_TOKEN;
  private static readonly MAX_RETRIES = 2;
  private static readonly INITIAL_BACKOFF_MS = 500;

  constructor(
    public readonly name: string,
    config: MCPServerConfig
  ) {
    this.config = config;
    this.logger = logger.child(name);
  }

  get isAvailable(): boolean {
    return this.available;
  }

  get isRequired(): boolean {
    return this.config.required;
  }

  get isSensitive(): boolean {
    return this.config.sensitive;
  }

  async initialize(): Promise<void> {
    try {
      this.available = await this.healthCheck();
      if (this.available) {
        this.logger.info(`MCP server is available at ${this.config.url}`);
      } else {
        this.logger.warn(`MCP server health check failed (${this.config.url})`);
      }
    } catch (error) {
      this.available = false;
      this.logger.warn(`MCP server initialization failed (${this.config.url})`, { error });
    }

    if (!this.available && this.isRequired) {
      throw new MCPUnavailableError(this.name);
    }
  }

  /** Build common headers including auth token when available */
  protected getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers['X-Annabelle-Token'] = this.token;
    }
    return headers;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.url}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(this.config.timeout),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  protected async callMCP(
    endpoint: string,
    method: 'GET' | 'POST' = 'POST',
    body?: unknown
  ): Promise<unknown> {
    if (!this.available) {
      throw new MCPUnavailableError(this.name);
    }

    const url = `${this.config.url}${endpoint}`;
    let lastError: unknown;

    for (let attempt = 0; attempt <= BaseMCPClient.MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const backoff = BaseMCPClient.INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        this.logger.debug(`Retry ${attempt}/${BaseMCPClient.MAX_RETRIES} for ${endpoint} after ${backoff}ms`);
        await new Promise(r => setTimeout(r, backoff));
      }

      const startTime = Date.now();

      try {
        const response = await fetch(url, {
          method,
          headers: this.getHeaders(),
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.config.timeout),
          // @ts-expect-error -- Node.js fetch supports dispatcher/agent via undici
          dispatcher: keepAliveAgent,
        });

        if (!response.ok) {
          const errorText = await response.text();
          const err = new MCPClientError(
            `MCP call failed: ${response.status} ${response.statusText}`,
            this.name,
            { status: response.status, body: errorText }
          );
          // Don't retry 4xx errors (client errors)
          if (response.status >= 400 && response.status < 500) throw err;
          lastError = err;
          continue;
        }

        return await response.json();
      } catch (error) {
        const elapsed = Date.now() - startTime;

        if (error instanceof MCPClientError && !isTransientError(error)) {
          throw error;
        }

        lastError = error;

        // Only retry transient errors
        if (!isTransientError(error)) {
          break;
        }
      }
    }

    // All retries exhausted — throw the last error
    const elapsed = Date.now();
    if (lastError instanceof MCPClientError) {
      throw lastError;
    }
    if (lastError instanceof Error && lastError.name === 'TimeoutError') {
      throw new MCPClientError(
        `MCP call timed out after retries (limit: ${this.config.timeout}ms). Check if ${this.name} service at ${this.config.url} is running.`,
        this.name,
        { timeout: this.config.timeout }
      );
    }
    throw new MCPClientError(
      `Failed to call MCP after ${BaseMCPClient.MAX_RETRIES + 1} attempts: ${lastError instanceof Error ? lastError.message : 'Unknown error'}`,
      this.name,
      { error: lastError }
    );
  }

  async callTool(toolCall: MCPToolCall): Promise<ToolCallResult> {
    this.logger.debug('Calling tool', { tool: toolCall.name, args: toolCall.arguments });

    try {
      const result = await this.callMCP('/tools/call', 'POST', {
        name: toolCall.name,
        arguments: toolCall.arguments,
      });

      this.logger.debug('Tool call succeeded', { tool: toolCall.name });
      return {
        success: true,
        content: result,
      };
    } catch (error) {
      this.logger.error('Tool call failed', { tool: toolCall.name, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Discover available tools from this MCP server.
   * MCPs expose tools via /tools/list endpoint.
   */
  async listTools(): Promise<MCPToolDefinition[]> {
    if (!this.available) {
      this.logger.warn('Cannot list tools - MCP not available');
      return [];
    }

    try {
      const result = await this.callMCP('/tools/list', 'GET') as { tools?: MCPToolDefinition[] };
      const tools = result.tools || [];
      this.logger.debug(`Discovered ${tools.length} tools from ${this.name}`);
      return tools;
    } catch (error) {
      this.logger.warn(`Failed to list tools from ${this.name}`, { error });
      return [];
    }
  }

  /**
   * Parse the text content from an MCP response.
   * MCP responses can have two formats:
   * 1. Direct array: { content: [{ type: 'text', text: '...' }] }
   * 2. Nested object: { content: { content: [{ type: 'text', text: '...' }] } }
   */
  protected parseTextResponse(result: { content?: unknown }): unknown | null {
    const content = result.content;

    // Handle direct array format: { content: [{ type: "text", text: "..." }] }
    if (Array.isArray(content)) {
      const firstItem = content[0];
      if (firstItem?.type === 'text' && typeof firstItem.text === 'string') {
        try {
          return JSON.parse(firstItem.text);
        } catch {
          this.logger.warn('Failed to parse text response as JSON');
          return null;
        }
      }
    }

    // Handle nested format: { content: { content: [{ type: "text", text: "..." }] } }
    if (
      typeof content === 'object' &&
      content !== null &&
      'content' in content &&
      Array.isArray((content as { content: unknown }).content)
    ) {
      const innerContent = (content as { content: Array<{ type: string; text: string }> }).content;
      if (innerContent[0]?.text) {
        try {
          return JSON.parse(innerContent[0].text);
        } catch {
          this.logger.warn('Failed to parse nested text response as JSON');
          return null;
        }
      }
    }
    return null;
  }
}
