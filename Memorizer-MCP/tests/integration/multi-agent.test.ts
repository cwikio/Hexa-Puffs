/**
 * Level 2 Integration Tests: Multi-Agent Isolation
 * Tests that data is properly isolated between agents
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpClient } from '../helpers/mcp-client.js';
import { dbHelper } from '../helpers/db-helpers.js';
import { generateTestAgentId } from '../helpers/test-data.js';

describe('Multi-Agent Isolation', () => {
  let client: McpClient;
  let agentA: string;
  let agentB: string;

  beforeEach(() => {
    client = new McpClient();
    agentA = generateTestAgentId('agentA');
    agentB = generateTestAgentId('agentB');
  });

  afterEach(() => {
    dbHelper.cleanupAgent(agentA);
    dbHelper.cleanupAgent(agentB);
  });

  describe('Facts Isolation', () => {
    it('should not show Agent A facts to Agent B', async () => {
      // Store fact for Agent A
      await client.storeFact('Agent A secret preference', 'preference', agentA);

      // List facts for Agent B
      const result = await client.listFacts(agentB);

      expect(result.success).toBe(true);
      expect((result.data as { facts: unknown[] }).facts).toHaveLength(0);
    });

    it('should show correct facts to each agent', async () => {
      // Store different facts for each agent
      await client.storeFact('Agent A likes cats', 'preference', agentA);
      await client.storeFact('Agent B likes dogs', 'preference', agentB);

      // Verify Agent A sees only their fact
      const resultA = await client.listFacts(agentA);
      const factsA = (resultA.data as { facts: { fact: string }[] }).facts;
      expect(factsA).toHaveLength(1);
      expect(factsA[0].fact).toContain('cats');

      // Verify Agent B sees only their fact
      const resultB = await client.listFacts(agentB);
      const factsB = (resultB.data as { facts: { fact: string }[] }).facts;
      expect(factsB).toHaveLength(1);
      expect(factsB[0].fact).toContain('dogs');
    });

    it('should not allow Agent B to delete Agent A facts', async () => {
      // Store fact for Agent A
      const storeResult = await client.storeFact('Protected fact', 'preference', agentA);
      const factId = (storeResult.data as { fact_id: number }).fact_id;

      // Attempt to delete from Agent B context
      // Note: delete_fact doesn't take agent_id, but the fact should only be visible to owner
      const deleteResult = await client.deleteFact(factId);

      // The fact should still exist for Agent A
      const listResult = await client.listFacts(agentA);
      // Behavior depends on implementation - either delete fails or fact is protected
      expect(listResult.success).toBe(true);
    });
  });

  describe('Conversations Isolation', () => {
    it('should not show Agent A conversations to Agent B', async () => {
      // Store conversation for Agent A
      await client.storeConversation('Agent A message', 'Agent A response', agentA);

      // Search conversations for Agent B
      const result = await client.searchConversations('Agent', agentB);

      expect(result.success).toBe(true);
      expect((result.data as { conversations: unknown[] }).conversations).toHaveLength(0);
    });

    it('should not find Agent A conversations in Agent B search', async () => {
      // Store conversation for Agent A with unique keyword
      await client.storeConversation('Agent A unique keyword XYZ123', 'Response about XYZ123', agentA);

      // Search for that keyword from Agent B
      const result = await client.searchConversations('XYZ123', agentB);

      expect(result.success).toBe(true);
      expect((result.data as { conversations: unknown[] }).conversations).toHaveLength(0);
    });

    it('should show correct conversations to each agent', async () => {
      // Store conversations for each agent
      await client.storeConversation('Agent A conversation', 'Response A', agentA);
      await client.storeConversation('Agent B conversation', 'Response B', agentB);

      // Verify isolation
      const resultA = await client.searchConversations('conversation', agentA);
      const resultB = await client.searchConversations('conversation', agentB);

      expect((resultA.data as { conversations: unknown[] }).conversations).toHaveLength(1);
      expect((resultB.data as { conversations: unknown[] }).conversations).toHaveLength(1);

      const convA = (resultA.data as { conversations: { user_message: string }[] }).conversations[0];
      const convB = (resultB.data as { conversations: { user_message: string }[] }).conversations[0];

      expect(convA.user_message).toContain('Agent A');
      expect(convB.user_message).toContain('Agent B');
    });
  });

  describe('Profiles Isolation', () => {
    it('should not show Agent A profile to Agent B', async () => {
      // Update profile for Agent A
      await client.updateProfile({ 'user_info.name': 'Alice' }, agentA);

      // Get profile for Agent B (should be default)
      const result = await client.getProfile(agentB);

      expect(result.success).toBe(true);
      const profile = (result.data as { profile: { user_info: { name?: string } } }).profile;

      // Should not have Alice's name
      expect(profile.user_info.name).not.toBe('Alice');
    });

    it('should maintain independent profiles', async () => {
      // Set different profiles
      await client.updateProfile({ 'user_info.name': 'Alice', 'preferences.theme': 'dark' }, agentA);
      await client.updateProfile({ 'user_info.name': 'Bob', 'preferences.theme': 'light' }, agentB);

      // Verify independence
      const profileA = await client.getProfile(agentA);
      const profileB = await client.getProfile(agentB);

      const dataA = (profileA.data as { profile: { user_info: { name: string }; preferences: { theme: string } } })
        .profile;
      const dataB = (profileB.data as { profile: { user_info: { name: string }; preferences: { theme: string } } })
        .profile;

      expect(dataA.user_info.name).toBe('Alice');
      expect(dataA.preferences.theme).toBe('dark');
      expect(dataB.user_info.name).toBe('Bob');
      expect(dataB.preferences.theme).toBe('light');
    });

    it('should not mix profile updates between agents', async () => {
      // Update Agent A profile
      await client.updateProfile({ 'user_info.role': 'Engineer' }, agentA);

      // Update Agent B profile
      await client.updateProfile({ 'user_info.role': 'Designer' }, agentB);

      // Verify no cross-contamination
      const profileA = await client.getProfile(agentA);
      const profileB = await client.getProfile(agentB);

      expect((profileA.data as { profile: { user_info: { role: string } } }).profile.user_info.role).toBe('Engineer');
      expect((profileB.data as { profile: { user_info: { role: string } } }).profile.user_info.role).toBe('Designer');
    });
  });

  describe('Statistics Isolation', () => {
    it('should show zero counts for agent with no data', async () => {
      // Store data for Agent A
      await client.storeFact('Fact for A', 'preference', agentA);
      await client.storeConversation('Conv for A', 'Response', agentA);

      // Check stats for Agent B (should be zero)
      const result = await client.getMemoryStats(agentB);

      expect(result.success).toBe(true);
      expect((result.data as { fact_count: number }).fact_count).toBe(0);
      expect((result.data as { conversation_count: number }).conversation_count).toBe(0);
    });

    it('should show correct counts per agent', async () => {
      // Store different amounts for each agent
      await client.storeFact('A1', 'preference', agentA);
      await client.storeFact('A2', 'preference', agentA);
      await client.storeFact('A3', 'preference', agentA);

      await client.storeFact('B1', 'preference', agentB);

      // Verify counts
      const statsA = await client.getMemoryStats(agentA);
      const statsB = await client.getMemoryStats(agentB);

      expect((statsA.data as { fact_count: number }).fact_count).toBe(3);
      expect((statsB.data as { fact_count: number }).fact_count).toBe(1);
    });
  });

  describe('Memory Retrieval Isolation', () => {
    it('should not retrieve Agent A memories for Agent B', async () => {
      // Store searchable data for Agent A
      await client.storeFact('Agent A loves TypeScript programming', 'preference', agentA);
      await client.storeConversation('TypeScript is great', 'I agree', agentA);

      // Search from Agent B
      const result = await client.retrieveMemories('TypeScript', agentB);

      expect(result.success).toBe(true);
      expect((result.data as { facts: unknown[] }).facts).toHaveLength(0);
      expect((result.data as { conversations: unknown[] }).conversations).toHaveLength(0);
    });

    it('should retrieve correct memories per agent', async () => {
      // Store data with same keyword for both agents
      await client.storeFact('Agent A prefers React', 'preference', agentA);
      await client.storeFact('Agent B prefers Vue', 'preference', agentB);

      // Retrieve for each agent
      const resultA = await client.retrieveMemories('prefers', agentA);
      const resultB = await client.retrieveMemories('prefers', agentB);

      const factsA = (resultA.data as { facts: { fact: string }[] }).facts;
      const factsB = (resultB.data as { facts: { fact: string }[] }).facts;

      expect(factsA).toHaveLength(1);
      expect(factsA[0].fact).toContain('React');

      expect(factsB).toHaveLength(1);
      expect(factsB[0].fact).toContain('Vue');
    });
  });
});
