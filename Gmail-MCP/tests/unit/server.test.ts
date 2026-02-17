/**
 * Unit tests for Gmail MCP server registration + annotations.
 * Uses InMemoryTransport — does NOT require a running server.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

// Mock Gmail client
vi.mock('../../src/gmail/client.js', () => ({
  listEmails: vi.fn(),
  getEmail: vi.fn(),
  sendEmail: vi.fn(),
  replyToEmail: vi.fn(),
  deleteEmail: vi.fn(),
  markAsRead: vi.fn(),
  modifyLabels: vi.fn(),
  getNewEmails: vi.fn(),
  listDrafts: vi.fn(),
  createDraft: vi.fn(),
  updateDraft: vi.fn(),
  sendDraft: vi.fn(),
  deleteDraft: vi.fn(),
  listLabels: vi.fn(),
  createLabel: vi.fn(),
  deleteLabel: vi.fn(),
  listAttachments: vi.fn(),
  getAttachment: vi.fn(),
  listFilters: vi.fn(),
  getFilter: vi.fn(),
  createFilter: vi.fn(),
  deleteFilter: vi.fn(),
}));

// Mock Calendar client
vi.mock('../../src/calendar/client.js', () => ({
  listCalendars: vi.fn(),
  listEvents: vi.fn(),
  getEvent: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  quickAddEvent: vi.fn(),
  findFreeTime: vi.fn(),
}));

// Mock Gmail auth
vi.mock('../../src/gmail/auth.js', () => ({
  hasValidToken: vi.fn(() => false),
  getAuthClient: vi.fn(),
}));

// Mock polling
vi.mock('../../src/gmail/polling.js', () => ({
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
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
    port: 8008,
    polling: { enabled: false, intervalMs: 60000 },
  })),
}));

import { createServer } from '../../src/server.js';

const EXPECTED_TOOLS = [
  // Messages
  'list_emails',
  'get_email',
  'send_email',
  'reply_email',
  'delete_email',
  'mark_read',
  'modify_labels',
  'get_new_emails',
  // Drafts
  'list_drafts',
  'create_draft',
  'update_draft',
  'send_draft',
  'delete_draft',
  // Labels
  'list_labels',
  'create_label',
  'delete_label',
  // Attachments
  'list_attachments',
  'get_attachment',
  // Calendar
  'list_calendars',
  'list_events',
  'get_event',
  'create_event',
  'update_event',
  'delete_event',
  'quick_add_event',
  'find_free_time',
  // Filters
  'list_filters',
  'get_filter',
  'create_filter',
  'delete_filter',
];

const READ_ONLY_TOOLS = [
  'list_emails',
  'get_email',
  'get_new_emails',
  'list_drafts',
  'list_labels',
  'list_attachments',
  'get_attachment',
  'list_calendars',
  'list_events',
  'get_event',
  'find_free_time',
  'list_filters',
  'get_filter',
];

const DESTRUCTIVE_TOOLS = [
  'delete_email',
  'delete_draft',
  'delete_label',
  'delete_event',
  'delete_filter',
];

describe('Gmail MCP Server Registration', () => {
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

  it('should register all 30 tools', () => {
    expect(tools).toHaveLength(30);
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

  it('should mark all tools as open-world (external Gmail/Calendar API)', () => {
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
