import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Logger, logger } from '@mcp/shared/Utils/logger.js';
import type {
  IMCPClient,
  MCPToolCall,
  MCPToolDefinition,
  ToolCallResult,
} from './types.js';

export interface StdioMCPConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number;
  required?: boolean;
  sensitive?: boolean;
}

/**
 * MCP client that connects to downstream MCPs via stdio transport.
 * This is the same pattern Claude Desktop uses.
 */
export class StdioMCPClient implements IMCPClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private available: boolean = false;
  protected logger: Logger;

  constructor(
    public readonly name: string,
    private config: StdioMCPConfig
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

  /**
   * Initialize the stdio connection to the MCP server.
   * Spawns the MCP process and establishes communication.
   */
  async initialize(): Promise<void> {
    try {
      this.logger.info(`Spawning MCP server: ${this.config.command} ${(this.config.args || []).join(' ')}`);

      // Create stdio transport that spawns the MCP process
      // Filter out undefined values and TRANSPORT env var (force child to use stdio)
      const envVars: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        // Skip undefined values and TRANSPORT (child MCPs should always use stdio)
        if (value !== undefined && key !== 'TRANSPORT') {
          envVars[key] = value;
        }
      }

      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        env: {
          ...envVars,
          ...this.config.env,
          // Force stdio transport for spawned MCPs
          TRANSPORT: 'stdio',
        },
        cwd: this.config.cwd,
        stderr: 'pipe',
      });

      // Pipe child stderr through orchestrator logger with MCP name context
      const stderrStream = this.transport.stderr;
      if (stderrStream) {
        stderrStream.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            this.logger.info(line);
          }
        });
      }

      // Create MCP client
      this.client = new Client(
        {
          name: 'orchestrator',
          version: '1.0.0',
        },
        {
          capabilities: {},
        }
      );

      // Connect client to transport
      await this.client.connect(this.transport);

      this.available = true;
      this.logger.info(`MCP server ${this.name} connected via stdio`);
    } catch (error) {
      this.available = false;
      this.logger.error(`Failed to initialize MCP server ${this.name}`, { error });

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

      // If the error suggests the process died, mark as unavailable
      if (message.includes('EPIPE') || message.includes('closed') || message.includes('not connected')) {
        this.available = false;
        this.logger.warn(`MCP ${this.name} appears to have crashed — marked unavailable`);
      }

      return {
        success: false,
        error: `[${this.name}] ${message}. The service may be temporarily unavailable — it will auto-restart shortly.`,
      };
    }
  }

  /**
   * Check if the MCP server process is healthy by listing tools.
   * Returns true if the server responds, false otherwise.
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
   * Restart the MCP server by closing and reinitializing.
   */
  async restart(): Promise<boolean> {
    this.logger.info(`Restarting MCP server ${this.name}...`);
    await this.close();

    try {
      await this.initialize();
      if (this.available) {
        this.logger.info(`MCP server ${this.name} restarted successfully`);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(`Failed to restart MCP server ${this.name}`, { error });
      return false;
    }
  }

  /**
   * Close the connection to the MCP server.
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
    this.logger.info(`MCP server ${this.name} disconnected`);
  }
}
