import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger before imports
vi.mock('@mcp/shared/Utils/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { GenericChannelAdapter } from '../../src/channels/adapters/generic-channel-adapter.js';
import type { ToolRouter } from '../../src/routing/tool-router.js';

// --- Helpers ---

function makeMcpResult(data: unknown) {
  return {
    success: true,
    content: {
      content: [{ type: 'text', text: JSON.stringify(data) }],
    },
  };
}

function makeStandardResponse(data: unknown) {
  return makeMcpResult({ success: true, data });
}

function makeToolRouter(overrides?: Partial<Record<string, unknown>>): ToolRouter {
  return {
    hasRoute: vi.fn().mockReturnValue(false),
    routeToolCall: vi.fn().mockResolvedValue({ success: false }),
    ...overrides,
  } as unknown as ToolRouter;
}

// --- Tests ---

describe('GenericChannelAdapter', () => {
  describe('constructor — tool name derivation', () => {
    it('derives correct tool names from mcpName "telegram"', () => {
      const router = makeToolRouter();
      const adapter = new GenericChannelAdapter('telegram', router);

      expect(adapter.channel).toBe('telegram');
    });

    it('derives correct tool names from mcpName "discord"', () => {
      const router = makeToolRouter();
      const adapter = new GenericChannelAdapter('discord', router);

      expect(adapter.channel).toBe('discord');
    });
  });

  describe('initialize — tool probing', () => {
    it('probes optional tools via hasRoute', async () => {
      const router = makeToolRouter({
        hasRoute: vi.fn().mockReturnValue(false),
      });

      const adapter = new GenericChannelAdapter('telegram', router);
      await adapter.initialize();

      expect(router.hasRoute).toHaveBeenCalledWith('telegram_get_me');
      expect(router.hasRoute).toHaveBeenCalledWith('telegram_list_chats');
      expect(router.hasRoute).toHaveBeenCalledWith('telegram_subscribe_chat');
    });

    it('fetches bot identity via get_me when available', async () => {
      const router = makeToolRouter({
        hasRoute: vi.fn().mockImplementation((name: string) => name === 'telegram_get_me'),
        routeToolCall: vi.fn().mockImplementation(async (name: string) => {
          if (name === 'telegram_get_me') {
            return makeStandardResponse({ user: { id: 'bot-123' } });
          }
          return { success: false };
        }),
      });

      const adapter = new GenericChannelAdapter('telegram', router);
      await adapter.initialize();

      expect(router.routeToolCall).toHaveBeenCalledWith('telegram_get_me', {});
    });

    it('degrades gracefully when get_me is unavailable', async () => {
      const router = makeToolRouter({
        hasRoute: vi.fn().mockReturnValue(false),
      });

      const adapter = new GenericChannelAdapter('telegram', router);
      // Should not throw
      await adapter.initialize();

      // Should not have attempted to call get_me
      expect(router.routeToolCall).not.toHaveBeenCalledWith('telegram_get_me', expect.anything());
    });

    it('uses subscribe_chat then list_chats fallback for chat discovery', async () => {
      const router = makeToolRouter({
        hasRoute: vi.fn().mockImplementation((name: string) =>
          name === 'test_subscribe_chat' || name === 'test_list_chats',
        ),
        routeToolCall: vi.fn().mockImplementation(async (name: string) => {
          if (name === 'test_subscribe_chat') {
            return makeStandardResponse({ subscriptions: ['chat-1', 'chat-2'] });
          }
          return { success: false };
        }),
      });

      const adapter = new GenericChannelAdapter('test', router);
      await adapter.initialize();

      // subscribe_chat was called; list_chats should NOT be called since subscriptions succeeded
      expect(router.routeToolCall).toHaveBeenCalledWith('test_subscribe_chat', { action: 'list' });
      expect(router.routeToolCall).not.toHaveBeenCalledWith('test_list_chats', expect.anything());
    });

    it('falls back to list_chats when subscribe_chat fails', async () => {
      const router = makeToolRouter({
        hasRoute: vi.fn().mockImplementation((name: string) =>
          name === 'test_subscribe_chat' || name === 'test_list_chats',
        ),
        routeToolCall: vi.fn().mockImplementation(async (name: string) => {
          if (name === 'test_subscribe_chat') {
            return makeStandardResponse({ subscriptions: [] });
          }
          if (name === 'test_list_chats') {
            return makeStandardResponse({ chats: [{ id: 'chat-1', type: 'user', title: 'Alice' }] });
          }
          return { success: false };
        }),
      });

      const adapter = new GenericChannelAdapter('test', router);
      await adapter.initialize();

      // Both were called since subscribe_chat returned empty
      expect(router.routeToolCall).toHaveBeenCalledWith('test_subscribe_chat', { action: 'list' });
      expect(router.routeToolCall).toHaveBeenCalledWith('test_list_chats', { limit: 20 });
    });
  });

  describe('poll — message fetching and filtering', () => {
    it('returns messages from get_messages via ToolRouter', async () => {
      const now = new Date();
      const router = makeToolRouter({
        hasRoute: vi.fn().mockReturnValue(false),
        routeToolCall: vi.fn().mockImplementation(async (name: string) => {
          if (name === 'test_get_messages') {
            return makeStandardResponse({
              messages: [
                { id: '1', chatId: 'chat-1', senderId: 'user-1', text: 'hello', date: now.toISOString() },
              ],
            });
          }
          return { success: false };
        }),
      });

      const adapter = new GenericChannelAdapter('test', router);
      await adapter.initialize();

      const messages = await adapter.poll();

      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('1');
      expect(messages[0].channel).toBe('test');
      expect(messages[0].text).toBe('hello');
    });

    it('returns empty array when get_messages fails', async () => {
      const router = makeToolRouter({
        hasRoute: vi.fn().mockReturnValue(false),
        routeToolCall: vi.fn().mockResolvedValue({ success: false }),
      });

      const adapter = new GenericChannelAdapter('test', router);
      await adapter.initialize();

      const messages = await adapter.poll();
      expect(messages).toEqual([]);
    });

    it('deduplicates messages across multiple polls', async () => {
      const now = new Date();
      const msg = { id: '1', chatId: 'chat-1', senderId: 'user-1', text: 'hello', date: now.toISOString() };

      const router = makeToolRouter({
        hasRoute: vi.fn().mockReturnValue(false),
        routeToolCall: vi.fn().mockImplementation(async (name: string) => {
          if (name === 'test_get_messages') {
            return makeStandardResponse({ messages: [msg] });
          }
          return { success: false };
        }),
      });

      const adapter = new GenericChannelAdapter('test', router);
      await adapter.initialize();

      const first = await adapter.poll();
      const second = await adapter.poll();

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(0); // deduped
    });

    it('filters out messages from bot self (when get_me is available)', async () => {
      const now = new Date();
      const router = makeToolRouter({
        hasRoute: vi.fn().mockImplementation((name: string) => name === 'test_get_me'),
        routeToolCall: vi.fn().mockImplementation(async (name: string) => {
          if (name === 'test_get_me') {
            return makeStandardResponse({ user: { id: 'bot-123' } });
          }
          if (name === 'test_get_messages') {
            return makeStandardResponse({
              messages: [
                { id: '1', chatId: 'chat-1', senderId: 'bot-123', text: 'bot message', date: now.toISOString() },
                { id: '2', chatId: 'chat-1', senderId: 'user-1', text: 'user message', date: now.toISOString() },
              ],
            });
          }
          return { success: false };
        }),
      });

      const adapter = new GenericChannelAdapter('test', router);
      await adapter.initialize();

      const messages = await adapter.poll();

      expect(messages).toHaveLength(1);
      expect(messages[0].senderId).toBe('user-1');
    });

    it('filters out messages matching bot patterns', async () => {
      const now = new Date();
      const router = makeToolRouter({
        hasRoute: vi.fn().mockReturnValue(false),
        routeToolCall: vi.fn().mockImplementation(async (name: string) => {
          if (name === 'test_get_messages') {
            return makeStandardResponse({
              messages: [
                { id: '1', chatId: 'chat-1', senderId: 'user-1', text: 'I encountered an error: something', date: now.toISOString() },
                { id: '2', chatId: 'chat-1', senderId: 'user-1', text: 'normal message', date: now.toISOString() },
              ],
            });
          }
          return { success: false };
        }),
      });

      const adapter = new GenericChannelAdapter('test', router);
      await adapter.initialize();

      const messages = await adapter.poll();

      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('normal message');
    });

    it('uses custom botPatterns from config', async () => {
      const now = new Date();
      const router = makeToolRouter({
        hasRoute: vi.fn().mockReturnValue(false),
        routeToolCall: vi.fn().mockImplementation(async (name: string) => {
          if (name === 'test_get_messages') {
            return makeStandardResponse({
              messages: [
                { id: '1', chatId: 'chat-1', senderId: 'user-1', text: 'CUSTOM_BOT: hi', date: now.toISOString() },
                { id: '2', chatId: 'chat-1', senderId: 'user-1', text: 'normal', date: now.toISOString() },
              ],
            });
          }
          return { success: false };
        }),
      });

      const adapter = new GenericChannelAdapter('test', router, { botPatterns: ['CUSTOM_BOT:'] });
      await adapter.initialize();

      const messages = await adapter.poll();

      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('normal');
    });

    it('filters out old messages based on maxMessageAgeMs', async () => {
      const now = new Date();
      const old = new Date(now.getTime() - 5 * 60 * 1000); // 5 min ago
      const recent = new Date(now.getTime() - 30 * 1000); // 30s ago

      const router = makeToolRouter({
        hasRoute: vi.fn().mockReturnValue(false),
        routeToolCall: vi.fn().mockImplementation(async (name: string) => {
          if (name === 'test_get_messages') {
            return makeStandardResponse({
              messages: [
                { id: '1', chatId: 'chat-1', senderId: 'user-1', text: 'old', date: old.toISOString() },
                { id: '2', chatId: 'chat-1', senderId: 'user-1', text: 'recent', date: recent.toISOString() },
              ],
            });
          }
          return { success: false };
        }),
      });

      // Default maxMessageAgeMs = 2 min → old message (5 min) should be filtered
      const adapter = new GenericChannelAdapter('test', router);
      await adapter.initialize();

      const messages = await adapter.poll();

      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('recent');
    });

    it('respects custom maxMessageAgeMs', async () => {
      const now = new Date();
      const msg3minAgo = new Date(now.getTime() - 3 * 60 * 1000); // 3 min ago

      const router = makeToolRouter({
        hasRoute: vi.fn().mockReturnValue(false),
        routeToolCall: vi.fn().mockImplementation(async (name: string) => {
          if (name === 'test_get_messages') {
            return makeStandardResponse({
              messages: [
                { id: '1', chatId: 'chat-1', senderId: 'user-1', text: 'msg', date: msg3minAgo.toISOString() },
              ],
            });
          }
          return { success: false };
        }),
      });

      // 10 min window → 3 min old message should pass
      const adapter = new GenericChannelAdapter('test', router, { maxMessageAgeMs: 10 * 60 * 1000 });
      await adapter.initialize();

      const messages = await adapter.poll();

      expect(messages).toHaveLength(1);
    });

    it('filters out empty/whitespace-only text', async () => {
      const now = new Date();
      const router = makeToolRouter({
        hasRoute: vi.fn().mockReturnValue(false),
        routeToolCall: vi.fn().mockImplementation(async (name: string) => {
          if (name === 'test_get_messages') {
            return makeStandardResponse({
              messages: [
                { id: '1', chatId: 'chat-1', senderId: 'user-1', text: '', date: now.toISOString() },
                { id: '2', chatId: 'chat-1', senderId: 'user-1', text: '   ', date: now.toISOString() },
                { id: '3', chatId: 'chat-1', senderId: 'user-1', text: 'real', date: now.toISOString() },
              ],
            });
          }
          return { success: false };
        }),
      });

      const adapter = new GenericChannelAdapter('test', router);
      await adapter.initialize();

      const messages = await adapter.poll();

      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe('real');
    });
  });

  describe('sendMessage', () => {
    it('calls send_message via ToolRouter with correct args', async () => {
      const router = makeToolRouter({
        hasRoute: vi.fn().mockReturnValue(false),
        routeToolCall: vi.fn().mockResolvedValue({ success: true }),
      });

      const adapter = new GenericChannelAdapter('telegram', router);
      await adapter.sendMessage('chat-1', 'Hello!');

      expect(router.routeToolCall).toHaveBeenCalledWith('telegram_send_message', {
        chat_id: 'chat-1',
        message: 'Hello!',
      });
    });

    it('handles send failure without throwing', async () => {
      const router = makeToolRouter({
        hasRoute: vi.fn().mockReturnValue(false),
        routeToolCall: vi.fn().mockRejectedValue(new Error('send failed')),
      });

      const adapter = new GenericChannelAdapter('telegram', router);

      // Should not throw
      await adapter.sendMessage('chat-1', 'Hello!');
    });
  });

  describe('shutdown', () => {
    it('clears internal state', async () => {
      const now = new Date();
      const router = makeToolRouter({
        hasRoute: vi.fn().mockReturnValue(false),
        routeToolCall: vi.fn().mockImplementation(async (name: string) => {
          if (name === 'test_get_messages') {
            return makeStandardResponse({
              messages: [
                { id: '1', chatId: 'chat-1', senderId: 'user-1', text: 'hello', date: now.toISOString() },
              ],
            });
          }
          return { success: false };
        }),
      });

      const adapter = new GenericChannelAdapter('test', router);
      await adapter.initialize();

      // First poll — message is processed
      const first = await adapter.poll();
      expect(first).toHaveLength(1);

      // Shutdown clears state
      await adapter.shutdown();

      // After shutdown + re-init, same message ID should be processable again
      // (processedMessageIds was cleared)
      await adapter.initialize();
      const second = await adapter.poll();
      expect(second).toHaveLength(1);
    });
  });
});
