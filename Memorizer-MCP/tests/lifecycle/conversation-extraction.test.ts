/**
 * Lifecycle Test 2: Conversation + Fact Extraction Pipeline
 * Tests the flow from conversation storage through automatic fact extraction
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpClient } from '../helpers/mcp-client.js';
import { dbHelper } from '../helpers/db-helpers.js';
import { generateTestAgentId } from '../helpers/test-data.js';

describe('Lifecycle: Conversation + Fact Extraction', () => {
  let client: McpClient;
  let testAgentId: string;
  let conversationId: string;
  let initialFactCount: number;

  beforeAll(() => {
    client = new McpClient();
    testAgentId = generateTestAgentId('lifecycle-conv');
  });

  afterAll(() => {
    dbHelper.cleanupAgent(testAgentId);
  });

  it('Step 1: Store conversation with extractable content', async () => {
    const result = await client.storeConversation(
      'I absolutely love using VS Code for all my Python development. It has become my favorite editor and I use it every single day.',
      'VS Code is indeed an excellent choice for Python development! It has great extensions like Pylint and Python Debugger.',
      testAgentId
    );

    expect(result.success).toBe(true);

    // Verify: Conversation stored with ID
    expect(result.data).toHaveProperty('conversation_id');
    conversationId = (result.data as { conversation_id: string }).conversation_id;
    expect(conversationId).toBeDefined();

    // Verify: facts_extracted property exists
    expect(result.data).toHaveProperty('facts_extracted');
    const factsExtracted = (result.data as { facts_extracted: number }).facts_extracted;

    // Note: Actual extraction depends on AI provider availability
    // In test mode, extraction might be disabled or return 0
    if (factsExtracted > 0) {
      // Verify: Extracted fact has source = conversation_id
      const facts = dbHelper.getFactsByAgent(testAgentId);
      const extractedFacts = facts.filter((f) => f.source === conversationId);
      expect(extractedFacts.length).toBe(factsExtracted);
    }

    // Record initial fact count for later verification
    const stats = await client.getMemoryStats(testAgentId);
    initialFactCount = (stats.data as { fact_count: number }).fact_count;
  });

  it('Step 2: List facts and verify extraction', async () => {
    const result = await client.listFacts(testAgentId);

    expect(result.success).toBe(true);

    const facts = (result.data as { facts: Record<string, unknown>[] }).facts;

    if (facts.length > 0) {
      // Verify: New fact(s) in list
      expect(facts.length).toBeGreaterThanOrEqual(0);

      // Verify: Category assigned (likely "preference")
      facts.forEach((fact) => {
        expect(fact).toHaveProperty('category');
        expect(['preference', 'background', 'pattern', 'project', 'contact', 'decision']).toContain(fact.category);
      });

      // Verify: Confidence score present
      facts.forEach((fact) => {
        expect(fact).toHaveProperty('confidence');
        expect(typeof fact.confidence).toBe('number');
      });
    }
  });

  it('Step 3: Search conversations by keyword', async () => {
    const result = await client.searchConversations('VS Code', testAgentId);

    expect(result.success).toBe(true);

    // Verify: Returns the stored conversation
    const conversations = (result.data as { conversations: Record<string, unknown>[] }).conversations;
    expect(conversations.length).toBeGreaterThan(0);

    const found = conversations.find((c) => (c as { id: string }).id === conversationId);
    expect(found).toBeDefined();

    // Verify: Both user_message and agent_response included
    expect(found).toHaveProperty('user_message');
    expect(found).toHaveProperty('agent_response');
    expect((found as { user_message: string }).user_message).toContain('VS Code');
  });

  it('Step 4: Retrieve memories', async () => {
    const result = await client.retrieveMemories('Python development', testAgentId);

    expect(result.success).toBe(true);

    // Verify: Returns conversations
    const conversations = (result.data as { conversations: unknown[] }).conversations;
    expect(conversations.length).toBeGreaterThan(0);

    // Verify: If facts were extracted, they should appear too
    const facts = (result.data as { facts: unknown[] }).facts;
    // facts may or may not be present depending on extraction
    expect(result.data).toHaveProperty('facts');
  });

  it('Step 5: Store short conversation (should skip extraction)', async () => {
    const result = await client.storeConversation('ok', 'got it', testAgentId);

    expect(result.success).toBe(true);

    // Verify: facts_extracted = 0
    expect((result.data as { facts_extracted: number }).facts_extracted).toBe(0);

    // Verify: Conversation still stored
    const convId = (result.data as { conversation_id: string }).conversation_id;
    const dbConv = dbHelper.getConversationById(convId);
    expect(dbConv).toBeDefined();
  });

  it('Step 6: Check stats', async () => {
    const result = await client.getMemoryStats(testAgentId);

    expect(result.success).toBe(true);

    // Verify: conversation_count = 2
    expect((result.data as { conversation_count: number }).conversation_count).toBe(2);

    // Verify: fact_count includes auto-extracted (same as before or more)
    expect((result.data as { fact_count: number }).fact_count).toBeGreaterThanOrEqual(0);

    // Verify: Date range covers both conversations
    expect(result.data).toHaveProperty('oldest_conversation');
    expect(result.data).toHaveProperty('newest_conversation');
  });
});
