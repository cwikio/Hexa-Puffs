import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolveToken, type MCPToolCallResult, type MCPHealthResult } from './mcp-test-client.js';

export interface MCPStdioTestClientOptions {
  /** Command to spawn (e.g. "node") */
  command: string;
  /** Arguments for the command (e.g. ["dist/index.js"]) */
  args: string[];
  /** Environment variables to add/override */
  env?: NodeJS.ProcessEnv;
  /** Tool name prefix (e.g. "filer_" when routing through Orchestrator - mostly for compat) */
  toolPrefix?: string;
  /** Request timeout in ms (default: 10000) */
  timeout?: number;
}

export class MCPStdioTestClient {
  private command: string;
  private args: string[];
  private env: NodeJS.ProcessEnv;
  private timeout: number;
  private toolPrefix: string;
  
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  constructor(options: MCPStdioTestClientOptions) {
    this.command = options.command;
    this.args = options.args;
    this.env = options.env || {};
    this.timeout = options.timeout ?? 10_000;
    this.toolPrefix = options.toolPrefix ?? '';
  }

  async start(): Promise<void> {
    if (this.client) return;

    // Merge env with current process env and sanitize to string only
    const rawEnv = { ...process.env, ...this.env };
    const transportEnv: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(rawEnv)) {
        if (value !== undefined) {
            transportEnv[key] = value;
        }
    }
    
    // Ensure auth token is present if needed by the server
    if (!transportEnv.HEXA_PUFFS_TOKEN && !transportEnv['X-Hexa-Puffs-Token']) {
        const token = resolveToken();
        if (token) transportEnv.HEXA_PUFFS_TOKEN = token;
    }

    this.transport = new StdioClientTransport({
      command: this.command,
      args: this.args,
      env: transportEnv
    });

    this.client = new Client(
      {
        name: "test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    await this.client.connect(this.transport);
  }

  async stop(): Promise<void> {
    if (this.transport) {
        await this.transport.close();
    }
    this.client = null;
    this.transport = null;
  }

  async healthCheck(): Promise<MCPHealthResult> {
    const start = Date.now();
    try {
        if (!this.client) await this.start();
        await this.client?.listTools();
        const duration = Date.now() - start;
        return { healthy: true, duration };
    } catch (error) {
        const duration = Date.now() - start;
        return { 
            healthy: false, 
            error: error instanceof Error ? error.message : 'Unknown error',
            duration 
        };
    }
  }

  async callTool<T = unknown>(
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<MCPToolCallResult<T>> {
    const start = Date.now();
    try {
      if (!this.client) await this.start();

      const prefixedName = this.toolPrefix ? `${this.toolPrefix}${toolName}` : toolName;
      
      const callPromise = this.client!.callTool({
        name: prefixedName,
        arguments: args,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Tool call timed out after ${this.timeout}ms`)), this.timeout);
      });

      // @ts-ignore
      const result = await Promise.race([callPromise, timeoutPromise]);

      // Handle result parsing
      let finalData: T | undefined;
      let finalError: string | undefined;
      let isSuccess = !result.isError;

      if (result.content && Array.isArray(result.content) && result.content[0]?.type === 'text') {
         try {
             const text = result.content[0].text;
             
             if (result.isError) {
                 finalError = text;
                 isSuccess = false;
             } else {
                 if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
                    try {
                        const parsed = JSON.parse(text);

                        // Unwrap StandardResponse wrapper: { success, data, error }
                        if (parsed && typeof parsed === 'object' && 'success' in parsed) {
                            isSuccess = parsed.success !== false;
                            finalData = ((parsed.data ?? parsed) as T);
                            if (parsed.error) {
                                finalError = String(parsed.error);
                                isSuccess = false;
                            }
                        } else if (parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error) {
                            finalData = parsed as T;
                            finalError = String(parsed.error);
                            isSuccess = false;
                        } else {
                            finalData = parsed as T;
                        }
                    } catch {
                        finalData = text as unknown as T;
                    }
                 } else {
                     finalData = text as unknown as T;
                 }
             }
         } catch (e) {
             // pass
         }
      }

      const duration = Date.now() - start;

      return {
          success: isSuccess,
          data: finalData ?? (result as unknown as T),
          error: finalError,
          duration
      };

    } catch (error) {
      const duration = Date.now() - start;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration,
      };
    }
  }

  getBaseUrl(): string {
    return `stdio:${this.command} ${this.args.join(' ')}`;
  }

  async listTools(): Promise<{ tools: { name: string; description?: string; inputSchema?: object }[] }> {
    if (!this.client) await this.start();
    const result = await this.client!.listTools();
    return {
        tools: result.tools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema
        }))
    };
  }
}
