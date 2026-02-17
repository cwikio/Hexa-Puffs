import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { ChannelManager } from '../../src/channels/channel-poller.js';
import type { ChannelAdapter } from '../../src/channels/channel-adapter.js';
import type { IncomingAgentMessage } from '../../src/agents/agent-types.js';

// --- Helpers ---

function makeMessage(overrides?: Partial<IncomingAgentMessage>): IncomingAgentMessage {
  return {
    id: 'msg-1',
    chatId: 'chat-1',
    senderId: 'user-1',
    text: 'hello',
    date: new Date().toISOString(),
    channel: 'test',
    agentId: 'main',
    ...overrides,
  };
}

function makeMockAdapter(channel: string, messages: IncomingAgentMessage[] = []): ChannelAdapter {
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

describe('ChannelManager', () => {
  let manager: ChannelManager;

  beforeEach(() => {
    manager = new ChannelManager({ intervalMs: 60000, maxMessagesPerCycle: 5 });
  });

  afterEach(() => {
    manager.stop();
  });

  describe('registerAdapter / getAdapter', () => {
    it('stores and retrieves adapters by channel name', () => {
      const adapter = makeMockAdapter('telegram');
      manager.registerAdapter(adapter);

      expect(manager.getAdapter('telegram')).toBe(adapter);
    });

    it('returns undefined for unregistered channels', () => {
      expect(manager.getAdapter('nonexistent')).toBeUndefined();
    });

    it('supports multiple adapters', () => {
      const tg = makeMockAdapter('telegram');
      const slack = makeMockAdapter('slack');
      manager.registerAdapter(tg);
      manager.registerAdapter(slack);

      expect(manager.getAdapter('telegram')).toBe(tg);
      expect(manager.getAdapter('slack')).toBe(slack);
      expect(manager.getChannels()).toHaveLength(2);
    });
  });

  describe('getChannels', () => {
    it('returns all registered channel names', () => {
      manager.registerAdapter(makeMockAdapter('telegram'));
      manager.registerAdapter(makeMockAdapter('discord'));

      const channels = manager.getChannels();
      expect(channels).toContain('telegram');
      expect(channels).toContain('discord');
    });

    it('returns empty array when no adapters registered', () => {
      expect(manager.getChannels()).toEqual([]);
    });
  });

  describe('initialize', () => {
    it('calls initialize on all registered adapters', async () => {
      const tg = makeMockAdapter('telegram');
      const slack = makeMockAdapter('slack');
      manager.registerAdapter(tg);
      manager.registerAdapter(slack);

      await manager.initialize();

      expect(tg.initialize).toHaveBeenCalledOnce();
      expect(slack.initialize).toHaveBeenCalledOnce();
    });

    it('handles adapter initialization failure gracefully', async () => {
      const good = makeMockAdapter('good');
      const bad = makeMockAdapter('bad');
      (bad.initialize as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('init failed'));

      manager.registerAdapter(bad);
      manager.registerAdapter(good);

      // Should not throw
      await manager.initialize();

      // Good adapter still initialized
      expect(good.initialize).toHaveBeenCalledOnce();
    });
  });

  describe('pollCycle (via start)', () => {
    it('dispatches messages from adapters via onMessage', async () => {
      const msg = makeMessage({ channel: 'telegram' });
      const adapter = makeMockAdapter('telegram', [msg]);
      manager.registerAdapter(adapter);

      const dispatched: IncomingAgentMessage[] = [];
      manager.onMessage = async (m) => { dispatched.push(m); };

      // Start triggers immediate pollCycle
      manager.start();

      // Wait for async poll cycle
      await vi.waitFor(() => expect(dispatched).toHaveLength(1));

      expect(dispatched[0]).toBe(msg);
    });

    it('caps messages per cycle per adapter', async () => {
      const messages = Array.from({ length: 10 }, (_, i) =>
        makeMessage({ id: `msg-${i}`, channel: 'telegram' }),
      );
      const adapter = makeMockAdapter('telegram', messages);

      // maxMessagesPerCycle = 5
      manager.registerAdapter(adapter);

      const dispatched: IncomingAgentMessage[] = [];
      manager.onMessage = async (m) => { dispatched.push(m); };

      manager.start();
      await vi.waitFor(() => expect(dispatched.length).toBeGreaterThan(0));

      // Should be capped at 5
      expect(dispatched).toHaveLength(5);
    });

    it('polls multiple adapters in a single cycle', async () => {
      const tgMsg = makeMessage({ id: 'tg-1', channel: 'telegram' });
      const slackMsg = makeMessage({ id: 'slack-1', channel: 'slack' });
      manager.registerAdapter(makeMockAdapter('telegram', [tgMsg]));
      manager.registerAdapter(makeMockAdapter('slack', [slackMsg]));

      const dispatched: IncomingAgentMessage[] = [];
      manager.onMessage = async (m) => { dispatched.push(m); };

      manager.start();
      await vi.waitFor(() => expect(dispatched).toHaveLength(2));

      const channels = dispatched.map((m) => m.channel);
      expect(channels).toContain('telegram');
      expect(channels).toContain('slack');
    });

    it('isolates adapter failures — one failing adapter does not block others', async () => {
      const badAdapter = makeMockAdapter('bad');
      (badAdapter.poll as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('poll failed'));

      const goodMsg = makeMessage({ channel: 'good' });
      const goodAdapter = makeMockAdapter('good', [goodMsg]);

      manager.registerAdapter(badAdapter);
      manager.registerAdapter(goodAdapter);

      const dispatched: IncomingAgentMessage[] = [];
      manager.onMessage = async (m) => { dispatched.push(m); };

      manager.start();
      await vi.waitFor(() => expect(dispatched).toHaveLength(1));

      expect(dispatched[0].channel).toBe('good');
    });

    it('does not dispatch when onMessage is null', async () => {
      const msg = makeMessage({ channel: 'telegram' });
      const adapter = makeMockAdapter('telegram', [msg]);
      manager.registerAdapter(adapter);
      manager.onMessage = null;

      manager.start();

      // Give poll cycle time to execute
      await new Promise((r) => setTimeout(r, 50));

      // poll was called but nothing dispatched (no crash)
      expect(adapter.poll).toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('calls shutdown on all adapters', () => {
      const tg = makeMockAdapter('telegram');
      const slack = makeMockAdapter('slack');
      manager.registerAdapter(tg);
      manager.registerAdapter(slack);

      manager.start();
      manager.stop();

      expect(tg.shutdown).toHaveBeenCalledOnce();
      expect(slack.shutdown).toHaveBeenCalledOnce();
    });

    it('is safe to call stop without start', () => {
      const adapter = makeMockAdapter('telegram');
      manager.registerAdapter(adapter);

      // Should not throw
      manager.stop();
    });
  });

  describe('start idempotency', () => {
    it('does not create duplicate timers on double start', () => {
      const adapter = makeMockAdapter('telegram');
      manager.registerAdapter(adapter);

      manager.start();
      manager.start(); // second call should be a no-op

      manager.stop();

      // poll called only once from the initial cycle (not twice)
      expect(adapter.poll).toHaveBeenCalledTimes(1);
    });
  });
});
