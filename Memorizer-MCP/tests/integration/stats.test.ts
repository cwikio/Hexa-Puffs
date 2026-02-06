/**
 * Level 2 Integration Tests: Statistics
 * Tests get_memory_stats
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpClient } from '../helpers/mcp-client.js';
import { dbHelper } from '../helpers/db-helpers.js';
import { CATEGORIES, generateTestAgentId } from '../helpers/test-data.js';

describe('Statistics', () => {
  let client: McpClient;
  let testAgentId: string;

  beforeEach(() => {
    client = new McpClient();
    testAgentId = generateTestAgentId('stats');
  });

  afterEach(() => {
    dbHelper.cleanupAgent(testAgentId);
  });

  describe('get_memory_stats', () => {
    it('should return all zero counts for empty agent', async () => {
      const result = await client.getMemoryStats(testAgentId);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('fact_count', 0);
      expect(result.data).toHaveProperty('conversation_count', 0);
    });

    it('should count facts correctly', async () => {
      await client.storeFact('Fact 1', 'preference', testAgentId);
      await client.storeFact('Fact 2', 'preference', testAgentId);
      await client.storeFact('Fact 3', 'background', testAgentId);

      const result = await client.getMemoryStats(testAgentId);

      expect(result.success).toBe(true);
      expect((result.data as { fact_count: number }).fact_count).toBe(3);
    });

    it('should count conversations correctly', async () => {
      await client.storeConversation('Msg 1', 'Resp 1', testAgentId);
      await client.storeConversation('Msg 2', 'Resp 2', testAgentId);

      const result = await client.getMemoryStats(testAgentId);

      expect(result.success).toBe(true);
      expect((result.data as { conversation_count: number }).conversation_count).toBe(2);
    });

    it('should show facts_by_category breakdown', async () => {
      await client.storeFact('Pref 1', 'preference', testAgentId);
      await client.storeFact('Pref 2', 'preference', testAgentId);
      await client.storeFact('Back 1', 'background', testAgentId);
      await client.storeFact('Proj 1', 'project', testAgentId);

      const result = await client.getMemoryStats(testAgentId);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('facts_by_category');

      const byCategory = (result.data as { facts_by_category: Record<string, number> }).facts_by_category;
      expect(byCategory.preference).toBe(2);
      expect(byCategory.background).toBe(1);
      expect(byCategory.project).toBe(1);
    });

    it('should include date range when conversations exist', async () => {
      await client.storeConversation('Test msg', 'Test resp', testAgentId);

      const result = await client.getMemoryStats(testAgentId);

      expect(result.success).toBe(true);
      // API returns oldest_conversation and newest_conversation
      expect(result.data).toHaveProperty('oldest_conversation');
      expect(result.data).toHaveProperty('newest_conversation');
    });

    it('should report database size', async () => {
      const result = await client.getMemoryStats(testAgentId);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('database_size_mb');
      expect((result.data as { database_size_mb: number }).database_size_mb).toBeGreaterThanOrEqual(0);
    });

    it('should only count data for specified agent', async () => {
      const otherAgent = generateTestAgentId('other');

      // Store data for both agents
      await client.storeFact('Test fact', 'preference', testAgentId);
      await client.storeFact('Other fact', 'preference', otherAgent);

      // Check stats for test agent only
      const result = await client.getMemoryStats(testAgentId);

      expect(result.success).toBe(true);
      expect((result.data as { fact_count: number }).fact_count).toBe(1);

      dbHelper.cleanupAgent(otherAgent);
    });

    it('should update counts after deletions', async () => {
      const storeResult = await client.storeFact('To delete', 'preference', testAgentId);
      const factId = (storeResult.data as { fact_id: number }).fact_id;

      // Verify count is 1
      let stats = await client.getMemoryStats(testAgentId);
      expect((stats.data as { fact_count: number }).fact_count).toBe(1);

      // Delete the fact
      await client.deleteFact(factId);

      // Verify count is 0
      stats = await client.getMemoryStats(testAgentId);
      expect((stats.data as { fact_count: number }).fact_count).toBe(0);
    });
  });
});
