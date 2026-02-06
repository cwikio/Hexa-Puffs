/**
 * Lifecycle Test 1: Fact Management Lifecycle
 * Tests the complete lifecycle of facts from creation to deletion
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpClient } from '../helpers/mcp-client.js';
import { dbHelper } from '../helpers/db-helpers.js';
import { generateTestAgentId } from '../helpers/test-data.js';

describe('Lifecycle: Fact Management', () => {
  let client: McpClient;
  let testAgentId: string;
  let createdFactIds: number[] = [];

  beforeAll(() => {
    client = new McpClient();
    testAgentId = generateTestAgentId('lifecycle-facts');
  });

  afterAll(() => {
    dbHelper.cleanupAgent(testAgentId);
  });

  it('Step 1: Store fact in "preference" category', async () => {
    const result = await client.storeFact('User prefers dark mode in all applications', 'preference', testAgentId);

    expect(result.success).toBe(true);

    // Verify: Fact stored with ID returned
    expect(result.data).toHaveProperty('fact_id');
    const factId = (result.data as { fact_id: number }).fact_id;
    expect(factId).toBeDefined();
    createdFactIds.push(factId);

    // Verify: Confidence score set (default 1.0)
    const dbFact = dbHelper.getFactById(factId);
    expect(dbFact).toBeDefined();
    expect(dbFact?.confidence).toBe(1.0);

    // Assert: created_at timestamp present
    expect(dbFact?.created_at).toBeDefined();
  });

  it('Step 2: Store 2 more facts in different categories', async () => {
    const result1 = await client.storeFact('User is a senior software engineer', 'background', testAgentId);

    const result2 = await client.storeFact('User decided to use TypeScript for the project', 'decision', testAgentId);

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    // Verify: Each has unique ID
    const id1 = (result1.data as { fact_id: number }).fact_id;
    const id2 = (result2.data as { fact_id: number }).fact_id;
    expect(id1).not.toBe(id2);
    expect(id1).not.toBe(createdFactIds[0]);

    createdFactIds.push(id1, id2);

    // Verify: Categories correctly assigned
    const fact1 = dbHelper.getFactById(id1);
    const fact2 = dbHelper.getFactById(id2);
    expect(fact1?.category).toBe('background');
    expect(fact2?.category).toBe('decision');
  });

  it('Step 3: List all facts', async () => {
    const result = await client.listFacts(testAgentId);

    expect(result.success).toBe(true);

    // Verify: Returns 3 facts
    const facts = (result.data as { facts: unknown[] }).facts;
    expect(facts).toHaveLength(3);

    // Verify: Total count = 3
    expect((result.data as { total_count: number }).total_count).toBe(3);

    // Verify: Each fact has all fields
    facts.forEach((fact: Record<string, unknown>) => {
      expect(fact).toHaveProperty('id');
      expect(fact).toHaveProperty('fact');
      expect(fact).toHaveProperty('category');
      expect(fact).toHaveProperty('confidence');
      expect(fact).toHaveProperty('created_at');
    });
  });

  it('Step 4: List by category filter', async () => {
    const result = await client.listFacts(testAgentId, 'preference');

    expect(result.success).toBe(true);

    // Verify: Only "preference" facts returned
    const facts = (result.data as { facts: { category: string }[] }).facts;
    expect(facts).toHaveLength(1);
    expect(facts[0].category).toBe('preference');

    // Verify: Other categories excluded
    facts.forEach((fact) => {
      expect(fact.category).not.toBe('background');
      expect(fact.category).not.toBe('decision');
    });
  });

  it('Step 5: Store duplicate fact', async () => {
    // Store the same fact as Step 1
    const result = await client.storeFact('User prefers dark mode in all applications', 'preference', testAgentId);

    expect(result.success).toBe(true);

    // Verify: Dedupe detected (message indicates already exists)
    expect((result.data as { message?: string }).message).toContain('already exists');

    // Verify: count still 3
    const listResult = await client.listFacts(testAgentId);
    expect((listResult.data as { total_count: number }).total_count).toBe(3);
  });

  it('Step 6: Delete one fact', async () => {
    const factIdToDelete = createdFactIds[1]; // Delete the background fact

    const result = await client.deleteFact(factIdToDelete);

    expect(result.success).toBe(true);

    // Verify: Fact removed
    const dbFact = dbHelper.getFactById(factIdToDelete);
    expect(dbFact).toBeUndefined();

    // Verify: List now shows 2 facts
    const listResult = await client.listFacts(testAgentId);
    expect((listResult.data as { facts: unknown[] }).facts).toHaveLength(2);

    // Verify: Deleted fact text returned
    expect(result.data).toHaveProperty('deleted_fact');
    expect((result.data as { deleted_fact: string }).deleted_fact).toContain('senior software engineer');
  });

  it('Step 7: Check stats', async () => {
    const result = await client.getMemoryStats(testAgentId);

    expect(result.success).toBe(true);

    // Verify: fact_count = 2
    expect((result.data as { fact_count: number }).fact_count).toBe(2);

    // Verify: facts_by_category reflects remaining
    const byCategory = (result.data as { facts_by_category: Record<string, number> }).facts_by_category;
    expect(byCategory.preference).toBe(1);
    expect(byCategory.decision).toBe(1);
    expect(byCategory.background || 0).toBe(0);
  });
});
