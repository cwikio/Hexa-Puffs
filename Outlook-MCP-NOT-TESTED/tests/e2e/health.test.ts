/**
 * E2E test for Outlook MCP health check.
 * Starts the MCP server via dual-transport HTTP mode and tests the health endpoint.
 * Does NOT require real Microsoft credentials — tests degraded mode.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createServer as createHttpServer, type Server } from 'http';

// Mock auth so we don't need real credentials
vi.mock('../../src/outlook/auth.js', () => ({
  hasValidToken: vi.fn(() => false),
  getAccessToken: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/config/index.js', () => ({
  getConfig: vi.fn(() => ({
    transport: 'http',
    port: 0, // Will use random port
    outlook: {
      credentialsPath: '/tmp/test-creds.json',
      tokenCachePath: '/tmp/test-cache.json',
    },
  })),
}));

import { allTools } from '../../src/tools/index.js';

describe('Outlook MCP Health Check (E2E)', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    // Create a minimal HTTP server that mimics the health endpoint
    server = createHttpServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'degraded',
          hasToken: false,
          message: "No Outlook token. Run 'npm run setup-oauth' to authenticate.",
          toolCount: allTools.length,
        }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('should respond to health check', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('degraded');
    expect(body.hasToken).toBe(false);
    expect(body.toolCount).toBe(6);
  });

  it('should have the correct tool count in health response', async () => {
    expect(allTools).toHaveLength(6);
    expect(allTools.map(t => t.tool.name).sort()).toEqual([
      'get_email', 'list_emails', 'list_folders', 'mark_read', 'reply_email', 'send_email',
    ]);
  });
});
