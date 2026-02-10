/**
 * Unit tests for MessageRouter.
 * Verifies channel binding resolution: exact match, wildcard, default fallback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the logger before importing MessageRouter
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

import { MessageRouter } from '../../src/agents/message-router.js';
import type { ChannelBinding } from '../../src/config/agents.js';

describe('MessageRouter', () => {
  const DEFAULT_AGENT = 'annabelle';

  describe('exact match', () => {
    it('should resolve to the agent with an exact channel+chatId binding', () => {
      const bindings: ChannelBinding[] = [
        { channel: 'telegram', chatId: '12345', agentId: 'work' },
        { channel: 'telegram', chatId: '*', agentId: 'personal' },
      ];
      const router = new MessageRouter(bindings, DEFAULT_AGENT);

      expect(router.resolveAgents('telegram', '12345')).toEqual(['work']);
    });

    it('should match the first exact binding when multiple exist for same chatId', () => {
      const bindings: ChannelBinding[] = [
        { channel: 'telegram', chatId: '100', agentId: 'first' },
        { channel: 'telegram', chatId: '100', agentId: 'second' },
      ];
      const router = new MessageRouter(bindings, DEFAULT_AGENT);

      expect(router.resolveAgents('telegram', '100')).toEqual(['first']);
    });

    it('should not match an exact binding from a different channel', () => {
      const bindings: ChannelBinding[] = [
        { channel: 'gmail', chatId: '12345', agentId: 'gmail-agent' },
      ];
      const router = new MessageRouter(bindings, DEFAULT_AGENT);

      expect(router.resolveAgents('telegram', '12345')).toEqual([DEFAULT_AGENT]);
    });
  });

  describe('wildcard match', () => {
    it('should fall back to wildcard when no exact match', () => {
      const bindings: ChannelBinding[] = [
        { channel: 'telegram', chatId: '12345', agentId: 'work' },
        { channel: 'telegram', chatId: '*', agentId: 'personal' },
      ];
      const router = new MessageRouter(bindings, DEFAULT_AGENT);

      expect(router.resolveAgents('telegram', '99999')).toEqual(['personal']);
    });

    it('should not match wildcard from a different channel', () => {
      const bindings: ChannelBinding[] = [
        { channel: 'gmail', chatId: '*', agentId: 'gmail-agent' },
      ];
      const router = new MessageRouter(bindings, DEFAULT_AGENT);

      expect(router.resolveAgents('telegram', '12345')).toEqual([DEFAULT_AGENT]);
    });

    it('exact match should take priority over wildcard', () => {
      const bindings: ChannelBinding[] = [
        { channel: 'telegram', chatId: '*', agentId: 'wildcard' },
        { channel: 'telegram', chatId: '100', agentId: 'exact' },
      ];
      const router = new MessageRouter(bindings, DEFAULT_AGENT);

      expect(router.resolveAgents('telegram', '100')).toEqual(['exact']);
    });
  });

  describe('default fallback', () => {
    it('should fall back to default agent when no bindings match', () => {
      const bindings: ChannelBinding[] = [
        { channel: 'gmail', chatId: '*', agentId: 'gmail-agent' },
      ];
      const router = new MessageRouter(bindings, DEFAULT_AGENT);

      expect(router.resolveAgents('telegram', '12345')).toEqual([DEFAULT_AGENT]);
    });

    it('should fall back to default agent when bindings are empty', () => {
      const router = new MessageRouter([], DEFAULT_AGENT);

      expect(router.resolveAgents('telegram', '12345')).toEqual([DEFAULT_AGENT]);
    });
  });

  describe('multi-channel', () => {
    it('should route different channels to different agents', () => {
      const bindings: ChannelBinding[] = [
        { channel: 'telegram', chatId: '*', agentId: 'telegram-agent' },
        { channel: 'gmail', chatId: '*', agentId: 'gmail-agent' },
      ];
      const router = new MessageRouter(bindings, DEFAULT_AGENT);

      expect(router.resolveAgents('telegram', '100')).toEqual(['telegram-agent']);
      expect(router.resolveAgents('gmail', 'inbox')).toEqual(['gmail-agent']);
    });
  });

  describe('updateBindings', () => {
    it('should change routing after bindings are updated', () => {
      const router = new MessageRouter(
        [{ channel: 'telegram', chatId: '*', agentId: 'old-agent' }],
        DEFAULT_AGENT,
      );

      expect(router.resolveAgents('telegram', '100')).toEqual(['old-agent']);

      router.updateBindings([
        { channel: 'telegram', chatId: '*', agentId: 'new-agent' },
      ]);

      expect(router.resolveAgents('telegram', '100')).toEqual(['new-agent']);
    });
  });

  describe('getBindings', () => {
    it('should return a copy of current bindings', () => {
      const bindings: ChannelBinding[] = [
        { channel: 'telegram', chatId: '*', agentId: 'agent' },
      ];
      const router = new MessageRouter(bindings, DEFAULT_AGENT);
      const returned = router.getBindings();

      expect(returned).toEqual(bindings);
      expect(returned).not.toBe(bindings); // different reference (copy)
    });
  });
});
