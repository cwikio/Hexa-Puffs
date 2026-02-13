/**
 * Shared transport layer for MCP services
 * Supports both stdio (default) and HTTP/SSE transports
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createServer as createHttpServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'http';

/**
 * Interface for MCP Server - uses structural typing to avoid
 * dependency conflicts between different node_modules
 */
interface MCPServer {
  connect(transport: unknown): Promise<void>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface TransportConfig {
  /** Transport type: 'stdio' (default) or 'sse'/'http' */
  transport: 'stdio' | 'sse' | 'http';
  /** Port for HTTP/SSE transport */
  port: number;
  /** Server name for logging */
  serverName: string;
  /** Optional: Shared auth token — requests to non-/health endpoints are rejected without it */
  token?: string;
  /** Optional: Additional health check data */
  onHealth?: () => Record<string, unknown>;
  /** Optional: Tool call handler for /tools/call endpoint (for testing) */
  onToolCall?: (name: string, args: unknown) => Promise<unknown>;
  /** Optional: Tool definitions for /tools/list endpoint (required for HTTP MCPs) */
  tools?: ToolDefinition[];
  /** Optional: Shutdown callback */
  onShutdown?: () => void | Promise<void>;
  /** Optional: Custom logger (defaults to console.error) */
  log?: (message: string, data?: unknown) => void;
}

export interface TransportResult {
  /** The HTTP server instance (null for stdio) */
  httpServer: HttpServer | null;
  /** Shutdown function */
  shutdown: () => Promise<void>;
}

/**
 * Start the MCP transport layer
 *
 * @example
 * ```typescript
 * const { shutdown } = await startTransport(server, {
 *   transport: 'sse',
 *   port: 8005,
 *   serverName: 'memory-mcp',
 *   onHealth: () => ({ dbConnected: true }),
 *   onShutdown: () => closeDatabase(),
 * });
 * ```
 */
export async function startTransport(
  server: MCPServer,
  config: TransportConfig
): Promise<TransportResult> {
  const log = config.log ?? ((msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    if (data) {
      console.error(`[${timestamp}] [INFO] [${config.serverName}] ${msg}`, JSON.stringify(data));
    } else {
      console.error(`[${timestamp}] [INFO] [${config.serverName}] ${msg}`);
    }
  });

  if (config.transport === 'stdio') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log('Running on stdio transport');

    return {
      httpServer: null,
      shutdown: async () => {
        if (config.onShutdown) {
          await config.onShutdown();
        }
      },
    };
  }

  // HTTP/SSE transport
  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS: restrict to localhost origins
    const origin = req.headers.origin;
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Annabelle-Token');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Health check endpoint (always open — no token required)
    if (req.url === '/health' && req.method === 'GET') {
      const healthData = config.onHealth ? config.onHealth() : {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', ...healthData }));
      return;
    }

    // Token auth: reject non-/health requests without valid token
    if (config.token && req.headers['x-annabelle-token'] !== config.token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // SSE endpoint
    if (req.url === '/sse' && req.method === 'GET') {
      log('SSE connection established');
      const transport = new SSEServerTransport('/message', res);
      await server.connect(transport);
      return;
    }

    // Message endpoint for SSE (handled internally by SSEServerTransport)
    if (req.url === '/message' && req.method === 'POST') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Tools call endpoint for HTTP testing (optional)
    if (req.url === '/tools/call' && req.method === 'POST' && config.onToolCall) {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on('end', async () => {
        try {
          const { name, arguments: args } = JSON.parse(body) as { name: string; arguments?: unknown };
          const result = await config.onToolCall!(name, args ?? {});

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            content: [{ type: 'text', text: JSON.stringify(result) }],
          }));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
                success: false,
              }),
            }],
          }));
        }
      });
      return;
    }

    // Tool listing endpoint for HTTP MCP discovery
    if (req.url === '/tools/list' && req.method === 'GET') {
      const tools = config.tools ?? [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tools }));
      return;
    }

    // Not found
    res.writeHead(404);
    res.end('Not found');
  });

  return new Promise((resolve) => {
    httpServer.listen(config.port, '127.0.0.1', () => {
      log(`Running on http://localhost:${config.port}`);
      log('Endpoints:');
      log('  GET  /health - Health check');
      log('  GET  /sse    - SSE connection');
      log('  POST /message - SSE messages');
      if (config.tools && config.tools.length > 0) {
        log(`  GET  /tools/list - List available tools (${config.tools.length} tools)`);
      }
      if (config.onToolCall) {
        log('  POST /tools/call - Direct tool calls');
      }

      // Setup graceful shutdown
      const shutdown = async () => {
        log('Shutting down...');
        if (config.onShutdown) {
          await config.onShutdown();
        }
        return new Promise<void>((resolveShutdown) => {
          httpServer.close(() => {
            log('Server closed');
            resolveShutdown();
          });
        });
      };

      process.once('SIGINT', () => {
        shutdown().then(() => process.exit(0));
      });
      process.once('SIGTERM', () => {
        shutdown().then(() => process.exit(0));
      });

      resolve({
        httpServer,
        shutdown,
      });
    });
  });
}
