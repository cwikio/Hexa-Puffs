/**
 * Level 2 Integration Tests: Facts Tools
 * Tests store_fact, list_facts, delete_fact
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpClient } from '../helpers/mcp-client.js';
import { dbHelper } from '../helpers/db-helpers.js';
import { CATEGORIES, SAMPLE_FACTS, generateTestAgentId } from '../helpers/test-data.js';

describe('Facts Tools', () => {
  let client: McpClient;
  let testAgentId: string;

  beforeEach(() => {
    client = new McpClient();
    testAgentId = generateTestAgentId('facts');
  });

  afterEach(() => {
    dbHelper.cleanupAgent(testAgentId);
  });

  describe('store_fact', () => {
    it('should store a new fact successfully', async () => {
      const result = await client.storeFact('User prefers dark mode', 'preference', testAgentId);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveProperty('fact_id');
      expect(result.data).toHaveProperty('stored_at');
    });

    it('should store facts in all 6 categories', async () => {
      for (const category of CATEGORIES) {
        const fact = SAMPLE_FACTS[category][0];
        const result = await client.storeFact(fact, category, testAgentId);

        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty('fact_id');
      }

      // Verify all 6 stored
      const listResult = await client.listFacts(testAgentId);
      expect(listResult.success).toBe(true);
      expect((listResult.data as { facts: unknown[] }).facts).toHaveLength(6);
    });

    it('should detect duplicate fact and update timestamp', async () => {
      const fact = 'User likes TypeScript';

      // Store first time
      const result1 = await client.storeFact(fact, 'preference', testAgentId);
      expect(result1.success).toBe(true);

      // Store same fact again
      const result2 = await client.storeFact(fact, 'preference', testAgentId);
      expect(result2.success).toBe(true);
      // Duplicate returns a message indicating it already exists
      expect((result2.data as { message?: string }).message).toContain('already exists');

      // Verify only 1 fact exists
      const listResult = await client.listFacts(testAgentId);
      expect((listResult.data as { facts: unknown[] }).facts).toHaveLength(1);
    });

    it('should store fact with custom agent_id', async () => {
      const customAgent = generateTestAgentId('custom');
      const result = await client.storeFact('Custom agent fact', 'preference', customAgent);

      expect(result.success).toBe(true);

      // Verify not visible to default agent
      const listDefault = await client.listFacts(testAgentId);
      expect((listDefault.data as { facts: unknown[] }).facts).toHaveLength(0);

      // Verify visible to custom agent
      const listCustom = await client.listFacts(customAgent);
      expect((listCustom.data as { facts: unknown[] }).facts).toHaveLength(1);

      dbHelper.cleanupAgent(customAgent);
    });

    it('should reject fact with invalid category', async () => {
      const result = await client.callTool('store_fact', {
        fact: 'Test fact',
        category: 'invalid_category',
        agent_id: testAgentId,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should set default confidence score of 1.0', async () => {
      const result = await client.storeFact('High confidence fact', 'preference', testAgentId);

      expect(result.success).toBe(true);

      // Verify in database
      const facts = dbHelper.getFactsByAgent(testAgentId);
      expect(facts[0].confidence).toBe(1.0);
    });
  });

  describe('list_facts', () => {
    beforeEach(async () => {
      // Populate with test facts
      await client.storeFact('Preference 1', 'preference', testAgentId);
      await client.storeFact('Preference 2', 'preference', testAgentId);
      await client.storeFact('Background 1', 'background', testAgentId);
    });

    it('should list all facts for agent', async () => {
      const result = await client.listFacts(testAgentId);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('facts');
      expect(result.data).toHaveProperty('total_count', 3);
      expect((result.data as { facts: unknown[] }).facts).toHaveLength(3);
    });

    it('should filter facts by category', async () => {
      const result = await client.listFacts(testAgentId, 'preference');

      expect(result.success).toBe(true);
      expect((result.data as { facts: unknown[] }).facts).toHaveLength(2);

      const facts = (result.data as { facts: { category: string }[] }).facts;
      facts.forEach((f) => expect(f.category).toBe('preference'));
    });

    it('should respect limit parameter', async () => {
      const result = await client.listFacts(testAgentId, undefined, 2);

      expect(result.success).toBe(true);
      expect((result.data as { facts: unknown[] }).facts).toHaveLength(2);
      expect((result.data as { total_count: number }).total_count).toBe(3);
    });

    it('should return empty array for agent with no facts', async () => {
      const emptyAgent = generateTestAgentId('empty');
      const result = await client.listFacts(emptyAgent);

      expect(result.success).toBe(true);
      expect((result.data as { facts: unknown[] }).facts).toHaveLength(0);
      expect((result.data as { total_count: number }).total_count).toBe(0);
    });

    it('should include all required fields in response', async () => {
      const result = await client.listFacts(testAgentId);

      const facts = (result.data as { facts: Record<string, unknown>[] }).facts;
      facts.forEach((fact) => {
        expect(fact).toHaveProperty('id');
        expect(fact).toHaveProperty('fact');
        expect(fact).toHaveProperty('category');
        expect(fact).toHaveProperty('confidence');
        expect(fact).toHaveProperty('created_at');
      });
    });
  });

  describe('delete_fact', () => {
    it('should delete existing fact', async () => {
      // Create fact
      const createResult = await client.storeFact('To be deleted', 'preference', testAgentId);
      const factId = (createResult.data as { fact_id: number }).fact_id;

      // Delete it
      const deleteResult = await client.deleteFact(factId);

      expect(deleteResult.success).toBe(true);
      expect(deleteResult.data).toHaveProperty('deleted_fact', 'To be deleted');

      // Verify gone
      const listResult = await client.listFacts(testAgentId);
      expect((listResult.data as { facts: unknown[] }).facts).toHaveLength(0);
    });

    it('should return error for non-existent fact', async () => {
      const result = await client.deleteFact(999999);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should only delete specified fact', async () => {
      // Create multiple facts
      await client.storeFact('Keep this 1', 'preference', testAgentId);
      const toDelete = await client.storeFact('Delete this', 'preference', testAgentId);
      await client.storeFact('Keep this 2', 'preference', testAgentId);

      // Delete middle one
      await client.deleteFact((toDelete.data as { fact_id: number }).fact_id);

      // Verify 2 remain
      const listResult = await client.listFacts(testAgentId);
      expect((listResult.data as { facts: unknown[] }).facts).toHaveLength(2);

      const facts = (listResult.data as { facts: { fact: string }[] }).facts;
      const factTexts = facts.map((f) => f.fact);
      expect(factTexts).toContain('Keep this 1');
      expect(factTexts).toContain('Keep this 2');
      expect(factTexts).not.toContain('Delete this');
    });
  });
});
