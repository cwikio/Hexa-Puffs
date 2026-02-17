/**
 * Unit tests for Telegram MCP server registration + annotations.
 * Uses InMemoryTransport — does NOT require a running Telegram connection.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// Mock the Telegram client before importing server
vi.mock('../../src/telegram/client.js', () => ({
  getClient: vi.fn(),
  disconnect: vi.fn(),
  getMe: vi.fn(),
  listChats: vi.fn(),
  getChat: vi.fn(),
  sendMessage: vi.fn(),
  getMessages: vi.fn(),
  searchMessages: vi.fn(),
  deleteMessages: vi.fn(),
  createGroup: vi.fn(),
  listContacts: vi.fn(),
  addContact: vi.fn(),
  searchUsers: vi.fn(),
  sendMedia: vi.fn(),
  downloadMedia: vi.fn(),
  markRead: vi.fn(),
}));

// Mock the Telegram events
vi.mock('../../src/telegram/events.js', () => ({
  getMessageQueue: vi.fn(() => []),
  clearMessageQueue: vi.fn(() => []),
  getQueueSize: vi.fn(() => 0),
  subscribeToChat: vi.fn(),
  unsubscribeFromChat: vi.fn(),
  getSubscribedChats: vi.fn(() => []),
  clearSubscriptions: vi.fn(),
  createMessageHandler: vi.fn(),
  createNewMessageEvent: vi.fn(),
}));

import { createServer } from '../../src/server.js';

const EXPECTED_TOOLS = [
  'send_message',
  'get_messages',
  'search_messages',
  'delete_messages',
  'list_chats',
  'get_chat',
  'create_group',
  'list_contacts',
  'add_contact',
  'search_users',
  'send_media',
  'download_media',
  'get_me',
  'mark_read',
  'get_new_messages',
  'subscribe_chat',
];

const READ_ONLY_TOOLS = [
  'get_messages',
  'search_messages',
  'list_chats',
  'get_chat',
  'list_contacts',
  'search_users',
  'download_media',
  'get_me',
  'get_new_messages',
  'subscribe_chat',
];

const DESTRUCTIVE_TOOLS = [
  'delete_messages',
];

describe('Telegram MCP Server Registration', () => {
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

  it('should register all 16 tools', () => {
    expect(tools).toHaveLength(16);
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

  it('should mark destructive tools correctly', () => {
    for (const tool of tools) {
      const expected = DESTRUCTIVE_TOOLS.includes(tool.name);
      expect(
        tool.annotations?.destructiveHint,
        `${tool.name} destructiveHint should be ${expected}`
      ).toBe(expected);
    }
  });

  it('should mark all tools as open-world (external Telegram API)', () => {
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
