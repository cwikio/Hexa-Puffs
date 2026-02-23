import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Logger, logger } from '@mcp/shared/Utils/logger.js';
import type {
  IMCPClient,
  MCPToolCall,
  MCPToolDefinition,
  ToolCallResult,
} from './types.js';

export interface HttpMCPConfig {
  url: string;
  headers?: Record<string, string>;
  timeout?: number;
  required?: boolean;
  sensitive?: boolean;
}

/**
 * MCP client that connects to remote MCPs via Streamable HTTP transport.
 * Used for external HTTP MCPs like GitHub MCP Server.
 */
export class HttpMCPClient implements IMCPClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private available: boolean = false;
  private _initError: string | undefined;
  protected logger: Logger;

  constructor(
    public readonly name: string,
    private config: HttpMCPConfig,
  ) {
    this.logger = logger.child(`mcp:${name}`);
  }

  get isAvailable(): boolean {
    return this.available;
  }

  get isRequired(): boolean {
    return this.config.required ?? false;
  }

  get isSensitive(): boolean {
    return this.config.sensitive ?? false;
  }

  get initError(): string | undefined {
    return this._initError;
  }

  /**
   * Initialize the HTTP connection to the remote MCP server.
   */
  async initialize(): Promise<void> {
    try {
      this.logger.info(`Connecting to HTTP MCP server: ${this.config.url}`);

      const requestInit: RequestInit = {};
      if (this.config.headers && Object.keys(this.config.headers).length > 0) {
        requestInit.headers = { ...this.config.headers };
      }

      this.transport = new StreamableHTTPClientTransport(
        new URL(this.config.url),
        { requestInit },
      );

      this.client = new Client(
        { name: 'orchestrator', version: '1.0.0' },
        { capabilities: {} },
      );

      await this.client.connect(this.transport);

      this.available = true;
      this.logger.info(`MCP server ${this.name} connected via HTTP`);
    } catch (error) {
      this.available = false;
      this._initError = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to initialize HTTP MCP server ${this.name}`, { error });

      if (this.isRequired) {
        throw new Error(`Required MCP server ${this.name} failed to initialize: ${error}`);
      }
    }
  }

  /**
   * List available tools from this MCP server.
   */
  async listTools(): Promise<MCPToolDefinition[]> {
    if (!this.client || !this.available) {
      this.logger.warn(`Cannot list tools - MCP ${this.name} not available`);
      return [];
    }

    try {
      const result = await this.client.listTools();
      const tools = result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema as MCPToolDefinition['inputSchema'],
      }));

      this.logger.debug(`Discovered ${tools.length} tools from ${this.name}`);
      return tools;
    } catch (error) {
      this.logger.error(`Failed to list tools from ${this.name}`, { error });
      return [];
    }
  }

  /**
   * Call a tool on this MCP server.
   */
  async callTool(toolCall: MCPToolCall): Promise<ToolCallResult> {
    if (!this.client || !this.available) {
      return {
        success: false,
        error: `MCP ${this.name} not available`,
      };
    }

    this.logger.debug('Calling tool', { tool: toolCall.name, args: toolCall.arguments });

    try {
      const result = await this.client.callTool({
        name: toolCall.name,
        arguments: toolCall.arguments,
      });

      this.logger.debug('Tool call succeeded', { tool: toolCall.name });

      return {
        success: true,
        content: result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Tool call failed', { tool: toolCall.name, error });

      // Mark unavailable on connection errors
      if (message.includes('fetch') || message.includes('ECONNREFUSED') || message.includes('network')) {
        this.available = false;
        this.logger.warn(`MCP ${this.name} appears unreachable — marked unavailable`);
      }

      return {
        success: false,
        error: `[${this.name}] ${message}. The service may be temporarily unavailable.`,
      };
    }
  }

  /**
   * Check if the MCP server is healthy by listing tools.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.client || !this.available) {
      return false;
    }

    try {
      await this.client.listTools();
      return true;
    } catch {
      this.logger.warn(`Health check failed for ${this.name}`);
      return false;
    }
  }

  /**
   * Restart by closing and reinitializing the HTTP connection.
   */
  async restart(): Promise<boolean> {
    this.logger.info(`Restarting HTTP MCP connection ${this.name}...`);
    await this.close();

    try {
      await this.initialize();
      if (this.available) {
        this.logger.info(`MCP server ${this.name} reconnected successfully`);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(`Failed to restart HTTP MCP ${this.name}`, { error });
      return false;
    }
  }

  /**
   * Close the connection to the remote MCP server.
   */
  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        this.logger.warn(`Error closing MCP client ${this.name}`, { error });
      }
      this.client = null;
    }

    if (this.transport) {
      try {
        await this.transport.close();
      } catch (error) {
        this.logger.warn(`Error closing transport for ${this.name}`, { error });
      }
      this.transport = null;
    }

    this.available = false;
    this.logger.info(`MCP server ${this.name} disconnected (HTTP)`);
  }
}
