import { describe, it, expect, afterEach, vi } from 'vitest';
import type { TransportResult } from '../Transport/dual-transport.js';

const TEST_TOKEN = 'test-secret-token-abc123';

// Track servers to clean up
const servers: TransportResult[] = [];

afterEach(async () => {
  for (const s of servers) {
    try { await s.shutdown(); } catch {}
  }
  servers.length = 0;
});

describe('startTransport', () => {
  describe('stdio mode', () => {
    it('should connect server via StdioServerTransport and return null httpServer', async () => {
      // Mock the SDK transport to avoid actual stdio binding
      vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: vi.fn().mockImplementation(() => ({})),
      }));

      // Re-import after mocking
      const { startTransport } = await import('../Transport/dual-transport.js');

      const mockServer = { connect: vi.fn().mockResolvedValue(undefined) };
      const result = await startTransport(mockServer, {
        transport: 'stdio',
        port: 0,
        serverName: 'test-stdio',
        log: () => {},
      });

      expect(mockServer.connect).toHaveBeenCalledOnce();
      expect(result.httpServer).toBeNull();

      vi.restoreAllMocks();
    });
  });

  describe('HTTP mode', () => {
    // Use the real module (no mocks) for HTTP tests
    async function startHttpServer(overrides: Record<string, unknown> = {}): Promise<{
      result: TransportResult;
      port: number;
    }> {
      // Clear module mock from stdio test
      vi.resetModules();
      const { startTransport } = await import('../Transport/dual-transport.js');

      const mockServer = { connect: vi.fn().mockResolvedValue(undefined) };
      const result = await startTransport(mockServer, {
        transport: 'http',
        port: 0, // OS-assigned
        serverName: 'test-http',
        token: TEST_TOKEN,
        log: () => {},
        ...overrides,
      });

      servers.push(result);
      const addr = result.httpServer!.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      return { result, port };
    }

    it('should start HTTP server and return httpServer instance', async () => {
      const { result } = await startHttpServer();
      expect(result.httpServer).not.toBeNull();
    });

    it('should respond to GET /health with status ok (no token needed)', async () => {
      const { port } = await startHttpServer();
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await res.json() as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(body.status).toBe('ok');
    });

    it('should include custom health data', async () => {
      const { port } = await startHttpServer({
        onHealth: () => ({ dbConnected: true, version: '1.0' }),
      });

      const res = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await res.json() as Record<string, unknown>;

      expect(body.dbConnected).toBe(true);
      expect(body.version).toBe('1.0');
    });

    it('should return 401 for /tools/list without token', async () => {
      const tools = [
        { name: 'search', description: 'Search things', inputSchema: {} },
      ];

      const { port } = await startHttpServer({ tools });
      const res = await fetch(`http://127.0.0.1:${port}/tools/list`);

      expect(res.status).toBe(401);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 401 for /tools/call without token', async () => {
      const onToolCall = vi.fn().mockResolvedValue({ success: true });

      const { port } = await startHttpServer({ onToolCall });
      const res = await fetch(`http://127.0.0.1:${port}/tools/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test', arguments: {} }),
      });

      expect(res.status).toBe(401);
      expect(onToolCall).not.toHaveBeenCalled();
    });

    it('should respond to GET /tools/list with valid token', async () => {
      const tools = [
        { name: 'search', description: 'Search things', inputSchema: {} },
        { name: 'create', description: 'Create things', inputSchema: {} },
      ];

      const { port } = await startHttpServer({ tools });
      const res = await fetch(`http://127.0.0.1:${port}/tools/list`, {
        headers: { 'X-Annabelle-Token': TEST_TOKEN },
      });
      const body = await res.json() as { tools: Array<{ name: string }> };

      expect(res.status).toBe(200);
      expect(body.tools).toHaveLength(2);
      expect(body.tools[0].name).toBe('search');
    });

    it('should invoke onToolCall for POST /tools/call with valid token', async () => {
      const onToolCall = vi.fn().mockResolvedValue({ success: true, data: 'result' });

      const { port } = await startHttpServer({ onToolCall });
      const res = await fetch(`http://127.0.0.1:${port}/tools/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Annabelle-Token': TEST_TOKEN,
        },
        body: JSON.stringify({ name: 'search', arguments: { q: 'test' } }),
      });

      expect(res.status).toBe(200);
      expect(onToolCall).toHaveBeenCalledWith('search', { q: 'test' });

      const body = await res.json() as { content: Array<{ type: string; text: string }> };
      expect(body.content[0].type).toBe('text');
      const parsed = JSON.parse(body.content[0].text);
      expect(parsed.success).toBe(true);
    });

    it('should skip token check when no token is configured', async () => {
      const tools = [
        { name: 'search', description: 'Search things', inputSchema: {} },
      ];

      // Explicitly pass token: undefined to disable auth
      const { port } = await startHttpServer({ tools, token: undefined });
      const res = await fetch(`http://127.0.0.1:${port}/tools/list`);

      expect(res.status).toBe(200);
      const body = await res.json() as { tools: Array<{ name: string }> };
      expect(body.tools).toHaveLength(1);
    });

    it('should return 404 for unknown routes (with token)', async () => {
      const { port } = await startHttpServer();
      const res = await fetch(`http://127.0.0.1:${port}/nonexistent`, {
        headers: { 'X-Annabelle-Token': TEST_TOKEN },
      });
      expect(res.status).toBe(404);
    });

    it('should handle OPTIONS for CORS preflight with localhost origin', async () => {
      const { port } = await startHttpServer();
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        method: 'OPTIONS',
        headers: { 'Origin': 'http://localhost:3000' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
      expect(res.headers.get('access-control-allow-headers')).toContain('X-Annabelle-Token');
    });

    it('should not set CORS origin for non-localhost origins', async () => {
      const { port } = await startHttpServer();
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        method: 'OPTIONS',
        headers: { 'Origin': 'http://evil.com' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('should shut down cleanly', async () => {
      const { result, port } = await startHttpServer();
      await result.shutdown();

      // Remove from tracking since we already shut down
      const idx = servers.indexOf(result);
      if (idx >= 0) servers.splice(idx, 1);

      // Server should no longer respond
      await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
    });
  });
});
