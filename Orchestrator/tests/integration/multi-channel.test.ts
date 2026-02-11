/**
 * Integration tests for multi-channel architecture.
 *
 * Tests end-to-end flow with mock adapters:
 *   - Two-channel routing (messages from different channels dispatched correctly)
 *   - Response delivery via correct adapter
 *   - Adapter failure isolation
 *   - Auto-wiring from discovered channel MCPs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
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

import { ChannelManager } from '../../src/channels/channel-poller.js';
import type { ChannelAdapter } from '../../src/channels/channel-adapter.js';
import type { IncomingAgentMessage } from '../../src/agents/agent-types.js';

// --- Helpers ---

function makeMessage(channel: string, overrides?: Partial<IncomingAgentMessage>): IncomingAgentMessage {
  return {
    id: `${channel}-msg-1`,
    chatId: `${channel}-chat-1`,
    senderId: 'user-1',
    text: `Hello from ${channel}`,
    date: new Date().toISOString(),
    channel,
    agentId: 'main',
    ...overrides,
  };
}

function makeMockAdapter(channel: string, messages: IncomingAgentMessage[] = []): ChannelAdapter & {
  initialize: ReturnType<typeof vi.fn>;
  poll: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
} {
  return {
    channel,
    initialize: vi.fn().mockResolvedValue(undefined),
    poll: vi.fn().mockResolvedValue(messages),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    getMonitoredChatIds: vi.fn().mockReturnValue([]),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

// --- Tests ---

describe('Multi-Channel Integration', () => {
  let manager: ChannelManager;

  beforeEach(() => {
    manager = new ChannelManager({ intervalMs: 60000, maxMessagesPerCycle: 10 });
  });

  afterEach(() => {
    manager.stop();
  });

  describe('two-channel routing', () => {
    it('dispatches messages from telegram and slack adapters in a single poll cycle', async () => {
      const tgMsg = makeMessage('telegram');
      const slackMsg = makeMessage('slack');

      const tgAdapter = makeMockAdapter('telegram', [tgMsg]);
      const slackAdapter = makeMockAdapter('slack', [slackMsg]);

      manager.registerAdapter(tgAdapter);
      manager.registerAdapter(slackAdapter);

      await manager.initialize();

      const dispatched: IncomingAgentMessage[] = [];
      manager.onMessage = async (msg) => { dispatched.push(msg); };

      manager.start();
      await vi.waitFor(() => expect(dispatched).toHaveLength(2));

      const channels = dispatched.map((m) => m.channel);
      expect(channels).toContain('telegram');
      expect(channels).toContain('slack');

      // Verify each message came from the right adapter
      const tgDispatched = dispatched.find((m) => m.channel === 'telegram');
      expect(tgDispatched?.text).toBe('Hello from telegram');

      const slackDispatched = dispatched.find((m) => m.channel === 'slack');
      expect(slackDispatched?.text).toBe('Hello from slack');
    });
  });

  describe('response delivery via correct adapter', () => {
    it('sendMessage routes to the correct adapter by channel name', async () => {
      const tgAdapter = makeMockAdapter('telegram');
      const slackAdapter = makeMockAdapter('slack');

      manager.registerAdapter(tgAdapter);
      manager.registerAdapter(slackAdapter);

      await manager.initialize();

      // Simulate sending a response to telegram
      const tgChannelAdapter = manager.getAdapter('telegram');
      await tgChannelAdapter!.sendMessage('tg-chat-1', 'Response for Telegram');

      // Simulate sending a response to slack
      const slackChannelAdapter = manager.getAdapter('slack');
      await slackChannelAdapter!.sendMessage('slack-chat-1', 'Response for Slack');

      expect(tgAdapter.sendMessage).toHaveBeenCalledWith('tg-chat-1', 'Response for Telegram');
      expect(slackAdapter.sendMessage).toHaveBeenCalledWith('slack-chat-1', 'Response for Slack');

      // Each adapter only received its own message
      expect(tgAdapter.sendMessage).toHaveBeenCalledTimes(1);
      expect(slackAdapter.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('adapter failure isolation', () => {
    it('one adapter poll failure does not block others', async () => {
      const badAdapter = makeMockAdapter('bad');
      badAdapter.poll.mockRejectedValue(new Error('poll crash'));

      const goodMsg = makeMessage('good');
      const goodAdapter = makeMockAdapter('good', [goodMsg]);

      manager.registerAdapter(badAdapter);
      manager.registerAdapter(goodAdapter);

      await manager.initialize();

      const dispatched: IncomingAgentMessage[] = [];
      manager.onMessage = async (msg) => { dispatched.push(msg); };

      manager.start();
      await vi.waitFor(() => expect(dispatched).toHaveLength(1));

      expect(dispatched[0].channel).toBe('good');
      expect(dispatched[0].text).toBe('Hello from good');
    });

    it('one adapter initialize failure does not block others', async () => {
      const badAdapter = makeMockAdapter('bad');
      badAdapter.initialize.mockRejectedValue(new Error('init crash'));

      const goodAdapter = makeMockAdapter('good');

      manager.registerAdapter(badAdapter);
      manager.registerAdapter(goodAdapter);

      // Should not throw
      await manager.initialize();

      // Good adapter was still initialized
      expect(goodAdapter.initialize).toHaveBeenCalledOnce();
    });
  });

  describe('slash command response routing', () => {
    it('getAdapter returns the correct adapter for response delivery', async () => {
      const tgAdapter = makeMockAdapter('telegram');
      const discordAdapter = makeMockAdapter('discord');

      manager.registerAdapter(tgAdapter);
      manager.registerAdapter(discordAdapter);

      // Simulate slash command from discord — response should go to discord adapter
      const discordResponse = manager.getAdapter('discord');
      expect(discordResponse).toBe(discordAdapter);

      await discordResponse!.sendMessage('discord-chat-1', '/status response');
      expect(discordAdapter.sendMessage).toHaveBeenCalledWith('discord-chat-1', '/status response');
      expect(tgAdapter.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('auto-wiring pattern', () => {
    it('adapters registered from discovered channel MCPs are all accessible', async () => {
      // Simulate what Orchestrator.startChannelPolling() does:
      // For each discovered MCP with isChannel=true, register an adapter
      const discoveredChannels = [
        { name: 'telegram' },
        { name: 'discord' },
        { name: 'slack' },
      ];

      for (const channel of discoveredChannels) {
        manager.registerAdapter(makeMockAdapter(channel.name));
      }

      expect(manager.getChannels()).toHaveLength(3);
      expect(manager.getChannels()).toContain('telegram');
      expect(manager.getChannels()).toContain('discord');
      expect(manager.getChannels()).toContain('slack');

      // Each adapter is retrievable
      for (const channel of discoveredChannels) {
        const adapter = manager.getAdapter(channel.name);
        expect(adapter).toBeDefined();
        expect(adapter!.channel).toBe(channel.name);
      }
    });
  });

  describe('multi-message ordering', () => {
    it('dispatches messages in adapter registration order', async () => {
      const tgMsgs = [
        makeMessage('telegram', { id: 'tg-1', text: 'first' }),
        makeMessage('telegram', { id: 'tg-2', text: 'second' }),
      ];
      const slackMsgs = [
        makeMessage('slack', { id: 'slack-1', text: 'slack-first' }),
      ];

      manager.registerAdapter(makeMockAdapter('telegram', tgMsgs));
      manager.registerAdapter(makeMockAdapter('slack', slackMsgs));

      const dispatched: IncomingAgentMessage[] = [];
      manager.onMessage = async (msg) => { dispatched.push(msg); };

      manager.start();
      await vi.waitFor(() => expect(dispatched).toHaveLength(3));

      // Telegram messages come first (registered first), then slack
      expect(dispatched[0].channel).toBe('telegram');
      expect(dispatched[1].channel).toBe('telegram');
      expect(dispatched[2].channel).toBe('slack');
    });
  });
});
