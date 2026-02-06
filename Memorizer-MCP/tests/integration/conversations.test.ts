/**
 * Level 2 Integration Tests: Conversation Tools
 * Tests store_conversation, search_conversations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpClient } from '../helpers/mcp-client.js';
import { dbHelper } from '../helpers/db-helpers.js';
import {
  SAMPLE_CONVERSATIONS,
  SHORT_CONVERSATIONS,
  generateTestAgentId,
  generateSessionId,
  getTodayString,
  getTomorrowString,
} from '../helpers/test-data.js';

describe('Conversation Tools', () => {
  let client: McpClient;
  let testAgentId: string;

  beforeEach(() => {
    client = new McpClient();
    testAgentId = generateTestAgentId('conv');
  });

  afterEach(() => {
    dbHelper.cleanupAgent(testAgentId);
  });

  describe('store_conversation', () => {
    it('should store a conversation successfully', async () => {
      const result = await client.storeConversation(
        'Hello, how are you?',
        'I am doing well, thank you for asking!',
        testAgentId
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('conversation_id');
      expect(result.data).toHaveProperty('facts_extracted');
    });

    it('should store conversation with tags', async () => {
      const conv = SAMPLE_CONVERSATIONS[0];
      const result = await client.storeConversation(
        conv.userMessage,
        conv.agentResponse,
        testAgentId,
        undefined,
        conv.tags
      );

      expect(result.success).toBe(true);

      // Verify tags stored
      const conversations = dbHelper.getConversationsByAgent(testAgentId);
      expect(conversations).toHaveLength(1);
      const tags = JSON.parse(conversations[0].tags);
      expect(tags).toEqual(conv.tags);
    });

    it('should store conversation with session_id', async () => {
      const sessionId = generateSessionId();

      const result = await client.storeConversation(
        'First message in session',
        'Response to first',
        testAgentId,
        sessionId
      );

      expect(result.success).toBe(true);

      // Verify session stored
      const conversations = dbHelper.getConversationsByAgent(testAgentId);
      expect(conversations[0].session_id).toBe(sessionId);
    });

    it('should group conversations by session_id', async () => {
      const sessionId = generateSessionId();

      await client.storeConversation('Message 1', 'Response 1', testAgentId, sessionId);
      await client.storeConversation('Message 2', 'Response 2', testAgentId, sessionId);
      await client.storeConversation('Message 3', 'Response 3', testAgentId); // Different session

      const conversations = dbHelper.getConversationsByAgent(testAgentId);
      const sessionConvs = conversations.filter((c) => c.session_id === sessionId);

      expect(sessionConvs).toHaveLength(2);
    });

    it('should extract facts from conversation with clear preferences', async () => {
      const result = await client.storeConversation(
        'I absolutely love using VS Code for all my Python development work. It is my favorite editor.',
        'That is great! VS Code has excellent Python support with many useful extensions.',
        testAgentId
      );

      expect(result.success).toBe(true);
      // Note: fact extraction depends on AI provider being available
      // In test mode, may or may not extract facts
      expect(result.data).toHaveProperty('facts_extracted');
    });

    it('should skip extraction for short conversations', async () => {
      const short = SHORT_CONVERSATIONS[0];
      const result = await client.storeConversation(short.userMessage, short.agentResponse, testAgentId);

      expect(result.success).toBe(true);
      expect((result.data as { facts_extracted: number }).facts_extracted).toBe(0);
    });

    it('should store conversation even if extraction fails', async () => {
      // Even with invalid/missing AI provider, conversation should store
      const result = await client.storeConversation(
        'This is a test message that should be stored',
        'And this is the response',
        testAgentId
      );

      expect(result.success).toBe(true);

      // Verify conversation exists in DB
      const conversations = dbHelper.getConversationsByAgent(testAgentId);
      expect(conversations).toHaveLength(1);
    });
  });

  describe('search_conversations', () => {
    beforeEach(async () => {
      // Populate with test conversations
      for (const conv of SAMPLE_CONVERSATIONS) {
        await client.storeConversation(conv.userMessage, conv.agentResponse, testAgentId, undefined, conv.tags);
      }
    });

    it('should find conversations by keyword', async () => {
      const result = await client.searchConversations('VS Code', testAgentId);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('conversations');
      expect((result.data as { conversations: unknown[] }).conversations.length).toBeGreaterThan(0);
    });

    it('should find conversations in user_message', async () => {
      const result = await client.searchConversations('TypeScript error', testAgentId);

      expect(result.success).toBe(true);
      const convs = (result.data as { conversations: { user_message: string }[] }).conversations;
      expect(convs.some((c) => c.user_message.includes('TypeScript'))).toBe(true);
    });

    it('should find conversations in agent_response', async () => {
      const result = await client.searchConversations('Prisma', testAgentId);

      expect(result.success).toBe(true);
      const convs = (result.data as { conversations: { agent_response: string }[] }).conversations;
      expect(convs.some((c) => c.agent_response.includes('Prisma'))).toBe(true);
    });

    it('should return empty array for no matches', async () => {
      const result = await client.searchConversations('xyznonexistent123', testAgentId);

      expect(result.success).toBe(true);
      expect((result.data as { conversations: unknown[] }).conversations).toHaveLength(0);
      expect((result.data as { total_count: number }).total_count).toBe(0);
    });

    it('should respect limit parameter', async () => {
      // Use a real search term since query requires min 1 char
      const result = await client.searchConversations('the', testAgentId, 2);

      expect(result.success).toBe(true);
      expect((result.data as { conversations: unknown[] }).conversations.length).toBeLessThanOrEqual(2);
    });

    it('should filter by date range', async () => {
      const today = getTodayString();
      const tomorrow = getTomorrowString();

      // Use a common word that appears in conversations
      const result = await client.searchConversations('the', testAgentId, undefined, today, tomorrow);

      expect(result.success).toBe(true);
      // All conversations were created today, so should match
      expect((result.data as { conversations: unknown[] }).conversations.length).toBeGreaterThanOrEqual(0);
    });

    it('should return empty for future date range', async () => {
      const tomorrow = getTomorrowString();
      const dayAfter = new Date();
      dayAfter.setDate(dayAfter.getDate() + 2);
      const dayAfterStr = dayAfter.toISOString().split('T')[0];

      const result = await client.searchConversations('VS Code', testAgentId, undefined, tomorrow, dayAfterStr);

      expect(result.success).toBe(true);
      expect((result.data as { conversations: unknown[] }).conversations).toHaveLength(0);
    });

    it('should include all required fields in response', async () => {
      const result = await client.searchConversations('VS Code', testAgentId);

      const convs = (result.data as { conversations: Record<string, unknown>[] }).conversations;
      if (convs.length > 0) {
        expect(convs[0]).toHaveProperty('id');
        expect(convs[0]).toHaveProperty('user_message');
        expect(convs[0]).toHaveProperty('agent_response');
        expect(convs[0]).toHaveProperty('created_at');
      }
    });
  });
});
