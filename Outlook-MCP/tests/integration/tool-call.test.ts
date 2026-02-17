/**
 * Integration tests for Outlook MCP tool calls via InMemoryTransport.
 * Tests the full path: MCP client → server → handler → mocked Graph client.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// Mock the Graph client layer
const mockListEmails = vi.fn();
const mockGetEmail = vi.fn();
const mockSendEmail = vi.fn();
const mockReplyToEmail = vi.fn();
const mockMarkRead = vi.fn();
const mockListFolders = vi.fn();

vi.mock('../../src/outlook/client.js', () => ({
  listEmails: (...args: unknown[]) => mockListEmails(...args),
  getEmail: (...args: unknown[]) => mockGetEmail(...args),
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  replyToEmail: (...args: unknown[]) => mockReplyToEmail(...args),
  markRead: (...args: unknown[]) => mockMarkRead(...args),
  listFolders: (...args: unknown[]) => mockListFolders(...args),
}));

vi.mock('../../src/outlook/auth.js', () => ({
  hasValidToken: vi.fn(() => true),
  getAccessToken: vi.fn(() => 'mock-token'),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/config/index.js', () => ({
  getConfig: vi.fn(() => ({
    transport: 'stdio',
    port: 8012,
    outlook: { credentialsPath: '/tmp/creds.json', tokenCachePath: '/tmp/cache.json' },
  })),
}));

import { createServer } from '../../src/server.js';

describe('Outlook MCP Tool Calls (Integration)', () => {
  let client: Client;

  beforeAll(async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);

    client = new Client({ name: 'integration-test', version: '1.0.0' });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
  });

  it('should call list_emails and return results', async () => {
    mockListEmails.mockResolvedValue({
      messages: [
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          subject: 'Test Email',
          from: { email: 'sender@test.com', name: 'Sender' },
          bodyPreview: 'Hello world...',
          date: '2026-02-17T10:00:00Z',
          isRead: false,
          hasAttachments: false,
          importance: 'normal',
        },
      ],
      totalCount: 1,
    });

    const result = await client.callTool({ name: 'list_emails', arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.data.messages).toHaveLength(1);
    expect(parsed.data.messages[0].subject).toBe('Test Email');
  });

  it('should call get_email with message_id', async () => {
    mockGetEmail.mockResolvedValue({
      id: 'msg-1',
      subject: 'Full Email',
      from: { email: 'sender@test.com' },
      to: [{ email: 'me@test.com' }],
      body: { html: '<p>Hello</p>' },
      isRead: true,
    });

    const result = await client.callTool({
      name: 'get_email',
      arguments: { message_id: 'msg-1' },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.data.subject).toBe('Full Email');
  });

  it('should call send_email with all fields', async () => {
    mockSendEmail.mockResolvedValue({ sent: true });

    const result = await client.callTool({
      name: 'send_email',
      arguments: {
        to: 'recipient@test.com',
        subject: 'Test Subject',
        body: 'Test Body',
      },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.data.sent).toBe(true);
  });

  it('should call reply_email', async () => {
    mockReplyToEmail.mockResolvedValue({ sent: true });

    const result = await client.callTool({
      name: 'reply_email',
      arguments: { message_id: 'msg-1', body: 'Reply body' },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);

    expect(parsed.success).toBe(true);
  });

  it('should call mark_read', async () => {
    mockMarkRead.mockResolvedValue({ marked: true });

    const result = await client.callTool({
      name: 'mark_read',
      arguments: { message_id: 'msg-1', read: true },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.data.marked).toBe(true);
  });

  it('should call list_folders', async () => {
    mockListFolders.mockResolvedValue([
      { id: 'folder-1', displayName: 'Inbox', totalItemCount: 42, unreadItemCount: 5 },
      { id: 'folder-2', displayName: 'Sent Items', totalItemCount: 100, unreadItemCount: 0 },
    ]);

    const result = await client.callTool({ name: 'list_folders', arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toHaveLength(2);
    expect(parsed.data[0].displayName).toBe('Inbox');
  });

  it('should return error for invalid input', async () => {
    const result = await client.callTool({
      name: 'get_email',
      arguments: {},
    });
    const content = result.content as Array<{ type: string; text: string }>;

    // MCP SDK may reject at protocol level (plain error string) or
    // our handler may catch it (JSON with success:false)
    const text = content[0].text;
    try {
      const parsed = JSON.parse(text);
      expect(parsed.success).toBe(false);
    } catch {
      // Protocol-level validation error — raw string
      expect(text.toLowerCase()).toContain('error');
    }
  });

  it('should return error when client throws', async () => {
    mockListEmails.mockRejectedValue(new Error('Graph API 401 Unauthorized'));

    const result = await client.callTool({ name: 'list_emails', arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('401 Unauthorized');
  });
});
