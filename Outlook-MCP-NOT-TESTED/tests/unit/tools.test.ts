/**
 * Unit tests for Outlook MCP tool handlers.
 * Tests input validation and error handling with mocked client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Outlook client
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

import {
  handleListEmails,
  handleGetEmail,
  handleSendEmail,
  handleReplyEmail,
  handleMarkRead,
} from '../../src/tools/messages.js';
import { handleListFolders } from '../../src/tools/folders.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleListEmails', () => {
  it('should return success with valid input', async () => {
    mockListEmails.mockResolvedValue({ messages: [], totalCount: 0 });

    const result = await handleListEmails({});
    expect(result.success).toBe(true);
    expect(mockListEmails).toHaveBeenCalledOnce();
  });

  it('should pass folder_id and search to client', async () => {
    mockListEmails.mockResolvedValue({ messages: [], totalCount: 0 });

    await handleListEmails({ folder_id: 'inbox', search: 'test', max_results: 10 });
    expect(mockListEmails).toHaveBeenCalledWith({
      folderId: 'inbox',
      search: 'test',
      filter: undefined,
      top: 10,
    });
  });

  it('should reject max_results over 50', async () => {
    const result = await handleListEmails({ max_results: 100 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid input');
  });

  it('should handle client errors gracefully', async () => {
    mockListEmails.mockRejectedValue(new Error('Network error'));

    const result = await handleListEmails({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });
});

describe('handleGetEmail', () => {
  it('should return success with valid message_id', async () => {
    mockGetEmail.mockResolvedValue({ id: 'msg-1', subject: 'Test' });

    const result = await handleGetEmail({ message_id: 'msg-1' });
    expect(result.success).toBe(true);
    expect(mockGetEmail).toHaveBeenCalledWith('msg-1');
  });

  it('should reject missing message_id', async () => {
    const result = await handleGetEmail({});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid input');
  });

  it('should reject empty message_id', async () => {
    const result = await handleGetEmail({ message_id: '' });
    expect(result.success).toBe(false);
  });
});

describe('handleSendEmail', () => {
  it('should send email with required fields', async () => {
    mockSendEmail.mockResolvedValue({ sent: true });

    const result = await handleSendEmail({
      to: 'test@example.com',
      subject: 'Hello',
      body: 'World',
    });
    expect(result.success).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: ['test@example.com'],
      subject: 'Hello',
      body: 'World',
      cc: undefined,
      bcc: undefined,
      isHtml: undefined,
    });
  });

  it('should split comma-separated addresses', async () => {
    mockSendEmail.mockResolvedValue({ sent: true });

    await handleSendEmail({
      to: 'a@test.com, b@test.com',
      subject: 'Hello',
      body: 'World',
      cc: 'c@test.com',
    });

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['a@test.com', 'b@test.com'],
        cc: ['c@test.com'],
      })
    );
  });

  it('should reject missing required fields', async () => {
    const result = await handleSendEmail({ to: 'test@example.com' });
    expect(result.success).toBe(false);
  });
});

describe('handleReplyEmail', () => {
  it('should reply with valid input', async () => {
    mockReplyToEmail.mockResolvedValue({ sent: true });

    const result = await handleReplyEmail({ message_id: 'msg-1', body: 'Thanks!' });
    expect(result.success).toBe(true);
    expect(mockReplyToEmail).toHaveBeenCalledWith('msg-1', 'Thanks!', undefined);
  });

  it('should reject missing body', async () => {
    const result = await handleReplyEmail({ message_id: 'msg-1' });
    expect(result.success).toBe(false);
  });
});

describe('handleMarkRead', () => {
  it('should mark as read', async () => {
    mockMarkRead.mockResolvedValue({ marked: true });

    const result = await handleMarkRead({ message_id: 'msg-1', read: true });
    expect(result.success).toBe(true);
    expect(mockMarkRead).toHaveBeenCalledWith('msg-1', true);
  });

  it('should mark as unread', async () => {
    mockMarkRead.mockResolvedValue({ marked: true });

    const result = await handleMarkRead({ message_id: 'msg-1', read: false });
    expect(result.success).toBe(true);
    expect(mockMarkRead).toHaveBeenCalledWith('msg-1', false);
  });

  it('should reject missing read boolean', async () => {
    const result = await handleMarkRead({ message_id: 'msg-1' });
    expect(result.success).toBe(false);
  });
});

describe('handleListFolders', () => {
  it('should return folders', async () => {
    mockListFolders.mockResolvedValue([
      { id: '1', displayName: 'Inbox', totalItemCount: 10, unreadItemCount: 3 },
    ]);

    const result = await handleListFolders();
    expect(result.success).toBe(true);
    expect(mockListFolders).toHaveBeenCalledOnce();
  });

  it('should handle errors gracefully', async () => {
    mockListFolders.mockRejectedValue(new Error('Graph API error'));

    const result = await handleListFolders();
    expect(result.success).toBe(false);
    expect(result.error).toContain('Graph API error');
  });
});
