import { describe, it, expect, vi } from 'vitest';

// Mock the op client so no real CLI calls happen during server creation
vi.mock('../src/op/client.js', () => ({
  listVaults: vi.fn(),
  listItems: vi.fn(),
  getItem: vi.fn(),
  readSecret: vi.fn(),
  OpClientError: class OpClientError extends Error {
    constructor(message: string) { super(message); }
  },
}));

import { createServer } from '../src/server.js';

describe('createServer', () => {
  it('should create a server instance', () => {
    const server = createServer();
    expect(server).toBeDefined();
  });

  it('should register all 4 tools', async () => {
    const server = createServer();

    // McpServer stores tools in a plain object _registeredTools
    const internals = server as unknown as { _registeredTools: Record<string, unknown> };
    const toolNames = Object.keys(internals._registeredTools);

    expect(toolNames).toContain('list_vaults');
    expect(toolNames).toContain('list_items');
    expect(toolNames).toContain('get_item');
    expect(toolNames).toContain('read_secret');
    expect(toolNames).toHaveLength(4);
  });
});
