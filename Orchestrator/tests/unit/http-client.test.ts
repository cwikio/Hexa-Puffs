import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks
const mockConnect = vi.hoisted(() => vi.fn());
const mockClose = vi.hoisted(() => vi.fn());
const mockListTools = vi.hoisted(() => vi.fn());
const mockCallTool = vi.hoisted(() => vi.fn());

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    close: mockClose,
    listTools: mockListTools,
    callTool: mockCallTool,
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({
    close: vi.fn(),
  })),
}));

vi.mock('@mcp/shared/Utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({
      warn: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import { HttpMCPClient } from '../../src/mcp-clients/http-client.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

describe('HttpMCPClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
  });

  // ─── Constructor / properties ───────────────────────────────────

  it('should expose name from constructor', () => {
    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    expect(client.name).toBe('github');
  });

  it('should default isAvailable to false before initialize', () => {
    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    expect(client.isAvailable).toBe(false);
  });

  it('should default isRequired and isSensitive to false', () => {
    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    expect(client.isRequired).toBe(false);
    expect(client.isSensitive).toBe(false);
  });

  it('should respect required and sensitive config', () => {
    const client = new HttpMCPClient('vault', {
      url: 'https://example.com/mcp/',
      required: true,
      sensitive: true,
    });
    expect(client.isRequired).toBe(true);
    expect(client.isSensitive).toBe(true);
  });

  // ─── initialize ─────────────────────────────────────────────────

  it('should set isAvailable to true on successful connect', async () => {
    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    await client.initialize();
    expect(client.isAvailable).toBe(true);
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('should pass headers via requestInit to transport', async () => {
    const client = new HttpMCPClient('github', {
      url: 'https://example.com/mcp/',
      headers: { Authorization: 'Bearer tok123' },
    });
    await client.initialize();

    const TransportCtor = StreamableHTTPClientTransport as unknown as ReturnType<typeof vi.fn>;
    expect(TransportCtor).toHaveBeenCalledWith(
      expect.any(URL),
      { requestInit: { headers: { Authorization: 'Bearer tok123' } } },
    );
  });

  it('should not pass headers when empty', async () => {
    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    await client.initialize();

    const TransportCtor = StreamableHTTPClientTransport as unknown as ReturnType<typeof vi.fn>;
    expect(TransportCtor).toHaveBeenCalledWith(
      expect.any(URL),
      { requestInit: {} },
    );
  });

  it('should stay unavailable on connect failure (non-required)', async () => {
    mockConnect.mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    await client.initialize();
    expect(client.isAvailable).toBe(false);
  });

  it('should throw on connect failure when required', async () => {
    mockConnect.mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new HttpMCPClient('github', {
      url: 'https://example.com/mcp/',
      required: true,
    });
    await expect(client.initialize()).rejects.toThrow(/Required MCP server github failed/);
    expect(client.isAvailable).toBe(false);
  });

  // ─── listTools ──────────────────────────────────────────────────

  it('should return empty array when not available', async () => {
    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    const tools = await client.listTools();
    expect(tools).toEqual([]);
  });

  it('should return mapped tool definitions', async () => {
    mockListTools.mockResolvedValue({
      tools: [
        { name: 'create_issue', description: 'Create a GitHub issue', inputSchema: { type: 'object' } },
        { name: 'list_repos', inputSchema: { type: 'object' } },
      ],
    });

    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    await client.initialize();
    const tools = await client.listTools();

    expect(tools).toHaveLength(2);
    expect(tools[0]).toEqual({
      name: 'create_issue',
      description: 'Create a GitHub issue',
      inputSchema: { type: 'object' },
    });
    expect(tools[1].description).toBe('');
  });

  it('should return empty array on listTools error', async () => {
    mockListTools.mockRejectedValue(new Error('timeout'));

    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    await client.initialize();
    const tools = await client.listTools();
    expect(tools).toEqual([]);
  });

  // ─── callTool ───────────────────────────────────────────────────

  it('should return error when not available', async () => {
    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    const result = await client.callTool({ name: 'create_issue', arguments: {} });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not available');
  });

  it('should return content on successful tool call', async () => {
    const mockResult = { content: [{ type: 'text', text: '{"id": 42}' }] };
    mockCallTool.mockResolvedValue(mockResult);

    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    await client.initialize();
    const result = await client.callTool({ name: 'create_issue', arguments: { title: 'Bug' } });

    expect(result.success).toBe(true);
    expect(result.content).toBe(mockResult);
    expect(mockCallTool).toHaveBeenCalledWith({ name: 'create_issue', arguments: { title: 'Bug' } });
  });

  it('should mark unavailable on connection-related errors', async () => {
    mockCallTool.mockRejectedValue(new Error('fetch failed'));

    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    await client.initialize();
    expect(client.isAvailable).toBe(true);

    const result = await client.callTool({ name: 'create_issue', arguments: {} });
    expect(result.success).toBe(false);
    expect(client.isAvailable).toBe(false);
  });

  it('should stay available on non-connection errors', async () => {
    mockCallTool.mockRejectedValue(new Error('Invalid argument: title is required'));

    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    await client.initialize();
    const result = await client.callTool({ name: 'create_issue', arguments: {} });

    expect(result.success).toBe(false);
    expect(result.error).toContain('title is required');
    expect(client.isAvailable).toBe(true);
  });

  // ─── healthCheck ────────────────────────────────────────────────

  it('should return false when not available', async () => {
    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    expect(await client.healthCheck()).toBe(false);
  });

  it('should return true when listTools succeeds', async () => {
    mockListTools.mockResolvedValue({ tools: [] });

    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    await client.initialize();
    expect(await client.healthCheck()).toBe(true);
  });

  it('should return false when listTools throws', async () => {
    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    await client.initialize();

    mockListTools.mockRejectedValueOnce(new Error('timeout'));
    expect(await client.healthCheck()).toBe(false);
  });

  // ─── restart ────────────────────────────────────────────────────

  it('should close and reinitialize', async () => {
    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    await client.initialize();
    expect(client.isAvailable).toBe(true);

    const result = await client.restart();
    expect(result).toBe(true);
    expect(mockClose).toHaveBeenCalled();
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it('should return false on restart failure', async () => {
    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    await client.initialize();

    mockConnect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await client.restart();
    expect(result).toBe(false);
    expect(client.isAvailable).toBe(false);
  });

  // ─── close ──────────────────────────────────────────────────────

  it('should set available to false and null out client', async () => {
    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    await client.initialize();
    expect(client.isAvailable).toBe(true);

    await client.close();
    expect(client.isAvailable).toBe(false);
    expect(mockClose).toHaveBeenCalled();
  });

  it('should be safe to call close multiple times', async () => {
    const client = new HttpMCPClient('github', { url: 'https://example.com/mcp/' });
    await client.close();
    await client.close();
    expect(client.isAvailable).toBe(false);
  });
});
