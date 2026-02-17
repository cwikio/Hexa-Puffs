/**
 * Level 2 Integration Tests: Memory Retrieval
 * Tests retrieve_memories
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpClient } from '../helpers/mcp-client.js';
import { dbHelper } from '../helpers/db-helpers.js';
import { generateTestAgentId } from '../helpers/test-data.js';

describe('Memory Retrieval', () => {
  let client: McpClient;
  let testAgentId: string;

  beforeEach(async () => {
    client = new McpClient();
    testAgentId = generateTestAgentId('memory');

    // Populate with test data
    await client.storeFact('User prefers dark mode in applications', 'preference', testAgentId);
    await client.storeFact('User works with TypeScript daily', 'pattern', testAgentId);
    await client.storeFact('User is building an MCP server project', 'project', testAgentId);

    await client.storeConversation(
      'I really enjoy using dark themes in all my apps',
      'Dark themes are great for reducing eye strain',
      testAgentId
    );
    await client.storeConversation(
      'Can you help me with my TypeScript code?',
      'Of course! What TypeScript help do you need?',
      testAgentId
    );
  });

  afterEach(() => {
    dbHelper.cleanupAgent(testAgentId);
  });

  describe('retrieve_memories', () => {
    it('should retrieve both facts and conversations', async () => {
      const result = await client.retrieveMemories('dark mode', testAgentId);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('facts');
      expect(result.data).toHaveProperty('conversations');
    });

    it('should find relevant facts by keyword', async () => {
      const result = await client.retrieveMemories('dark mode', testAgentId);

      expect(result.success).toBe(true);
      const facts = (result.data as { facts: { fact: string }[] }).facts;
      expect(facts.some((f) => f.fact.toLowerCase().includes('dark'))).toBe(true);
    });

    it('should find relevant conversations by keyword', async () => {
      const result = await client.retrieveMemories('TypeScript', testAgentId);

      expect(result.success).toBe(true);
      const convs = (result.data as { conversations: { user_message: string }[] }).conversations;
      expect(convs.some((c) => c.user_message.toLowerCase().includes('typescript'))).toBe(true);
    });

    it('should return only facts when include_conversations is false', async () => {
      const result = await client.retrieveMemories('dark', testAgentId, undefined, false);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('facts');
      // Conversations should be empty or not included
      const convs = (result.data as { conversations?: unknown[] }).conversations;
      expect(!convs || convs.length === 0).toBe(true);
    });

    it('should respect limit parameter for facts', async () => {
      // Add more facts
      await client.storeFact('Another dark mode preference', 'preference', testAgentId);
      await client.storeFact('Dark theme is preferred', 'preference', testAgentId);

      const result = await client.retrieveMemories('dark', testAgentId, 2);

      expect(result.success).toBe(true);
      const facts = (result.data as { facts: unknown[] }).facts;
      expect(facts.length).toBeLessThanOrEqual(2);
    });

    it('should sort facts by confidence (highest first)', async () => {
      // Store facts (all will have default confidence 1.0)
      // In real scenario, extracted facts may have different confidence
      const result = await client.retrieveMemories('mode', testAgentId);

      expect(result.success).toBe(true);
      const facts = (result.data as { facts: { confidence: number }[] }).facts;

      if (facts.length > 1) {
        // Verify sorted by confidence descending
        for (let i = 1; i < facts.length; i++) {
          expect(facts[i - 1].confidence).toBeGreaterThanOrEqual(facts[i].confidence);
        }
      }
    });

    it('should return empty results for non-matching query', async () => {
      const result = await client.retrieveMemories('xyznonexistent123', testAgentId);

      expect(result.success).toBe(true);
      expect((result.data as { facts: unknown[] }).facts).toHaveLength(0);
      expect((result.data as { conversations: unknown[] }).conversations).toHaveLength(0);
    });

    it('should handle multi-word queries', async () => {
      const result = await client.retrieveMemories('MCP server project', testAgentId);

      expect(result.success).toBe(true);
      const facts = (result.data as { facts: { fact: string }[] }).facts;
      expect(facts.some((f) => f.fact.toLowerCase().includes('mcp'))).toBe(true);
    });

    it('should be case-insensitive', async () => {
      const upperResult = await client.retrieveMemories('DARK MODE', testAgentId);
      const lowerResult = await client.retrieveMemories('dark mode', testAgentId);

      expect(upperResult.success).toBe(true);
      expect(lowerResult.success).toBe(true);

      // Both should find the same facts
      const upperFacts = (upperResult.data as { facts: unknown[] }).facts;
      const lowerFacts = (lowerResult.data as { facts: unknown[] }).facts;
      expect(upperFacts.length).toBe(lowerFacts.length);
    });
  });
});
