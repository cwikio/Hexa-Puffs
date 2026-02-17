/**
 * Unit tests for Outlook MCP server registration + annotations.
 * Uses InMemoryTransport — does NOT require a running server or real credentials.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// Mock Outlook client
vi.mock('../../src/outlook/client.js', () => ({
  listEmails: vi.fn(),
  getEmail: vi.fn(),
  sendEmail: vi.fn(),
  replyToEmail: vi.fn(),
  markRead: vi.fn(),
  listFolders: vi.fn(),
}));

// Mock Outlook auth
vi.mock('../../src/outlook/auth.js', () => ({
  hasValidToken: vi.fn(() => false),
  getAccessToken: vi.fn(),
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock config
vi.mock('../../src/config/index.js', () => ({
  getConfig: vi.fn(() => ({
    transport: 'stdio',
    port: 8012,
    outlook: {
      credentialsPath: '/tmp/test-creds.json',
      tokenCachePath: '/tmp/test-cache.json',
    },
  })),
}));

import { createServer } from '../../src/server.js';

const EXPECTED_TOOLS = [
  'list_emails',
  'get_email',
  'send_email',
  'reply_email',
  'mark_read',
  'list_folders',
];

const READ_ONLY_TOOLS = [
  'list_emails',
  'get_email',
  'list_folders',
];

const DESTRUCTIVE_TOOLS: string[] = [];

describe('Outlook MCP Server Registration', () => {
  let client: Client;
  let tools: Tool[];

  beforeAll(async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0.0' });
    await client.connect(clientTransport);

    const result = await client.listTools();
    tools = result.tools;
  });

  afterAll(async () => {
    await client.close();
  });

  it('should register all 6 tools', () => {
    expect(tools).toHaveLength(6);
  });

  it('should register tools with correct names', () => {
    const toolNames = tools.map(t => t.name).sort();
    expect(toolNames).toEqual([...EXPECTED_TOOLS].sort());
  });

  it('should have non-empty descriptions on all tools', () => {
    for (const tool of tools) {
      expect(tool.description, `${tool.name} should have a description`).toBeTruthy();
      expect(tool.description!.length, `${tool.name} description should not be empty`).toBeGreaterThan(0);
    }
  });

  it('should have annotations on all tools', () => {
    for (const tool of tools) {
      expect(tool.annotations, `${tool.name} should have annotations`).toBeDefined();
    }
  });

  it('should mark read-only tools correctly', () => {
    for (const tool of tools) {
      const expected = READ_ONLY_TOOLS.includes(tool.name);
      expect(
        tool.annotations?.readOnlyHint,
        `${tool.name} readOnlyHint should be ${expected}`
      ).toBe(expected);
    }
  });

  it('should have no destructive tools in v1', () => {
    for (const tool of tools) {
      const expected = DESTRUCTIVE_TOOLS.includes(tool.name);
      expect(
        tool.annotations?.destructiveHint,
        `${tool.name} destructiveHint should be ${expected}`
      ).toBe(expected);
    }
  });

  it('should mark all tools as open-world (external Graph API)', () => {
    for (const tool of tools) {
      expect(
        tool.annotations?.openWorldHint,
        `${tool.name} openWorldHint should be true`
      ).toBe(true);
    }
  });

  it('should have input schemas on all tools', () => {
    for (const tool of tools) {
      expect(tool.inputSchema, `${tool.name} should have an inputSchema`).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });
});
