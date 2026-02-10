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

export abstract class BaseMCPClient implements IMCPClient {
  protected config: MCPServerConfig;
  protected logger: Logger;
  protected available: boolean = false;
  private readonly token: string | undefined = process.env.ANNABELLE_TOKEN;

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
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        method,
        headers: this.getHeaders(),
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new MCPClientError(
          `MCP call failed: ${response.status} ${response.statusText}`,
          this.name,
          { status: response.status, body: errorText }
        );
      }

      return await response.json();
    } catch (error) {
      const elapsed = Date.now() - startTime;

      if (error instanceof MCPClientError) {
        throw error;
      }

      // Detect timeout errors
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new MCPClientError(
          `MCP call timed out after ${elapsed}ms (limit: ${this.config.timeout}ms). Check if ${this.name} service at ${this.config.url} is running.`,
          this.name,
          { timeout: this.config.timeout, elapsed }
        );
      }

      throw new MCPClientError(
        `Failed to call MCP: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.name,
        { error, elapsed }
      );
    }
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
