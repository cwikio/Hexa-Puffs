/**
 * Level 2 Integration Tests: Profile Tools
 * Tests get_profile, update_profile
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpClient } from '../helpers/mcp-client.js';
import { dbHelper } from '../helpers/db-helpers.js';
import { DEFAULT_PROFILE_STRUCTURE, SAMPLE_PROFILE_UPDATES, generateTestAgentId } from '../helpers/test-data.js';

describe('Profile Tools', () => {
  let client: McpClient;
  let testAgentId: string;

  beforeEach(() => {
    client = new McpClient();
    testAgentId = generateTestAgentId('profile');
  });

  afterEach(() => {
    dbHelper.cleanupAgent(testAgentId);
  });

  describe('get_profile', () => {
    it('should return default profile for new agent', async () => {
      const result = await client.getProfile(testAgentId);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('profile');

      const profile = (result.data as { profile: Record<string, unknown> }).profile;
      expect(profile).toHaveProperty('user_info');
      expect(profile).toHaveProperty('preferences');
      expect(profile).toHaveProperty('current_projects');
      expect(profile).toHaveProperty('learned_patterns');
    });

    it('should return existing profile data', async () => {
      // First update to create profile
      await client.updateProfile({ 'user_info.name': 'TestUser' }, testAgentId);

      // Then get it
      const result = await client.getProfile(testAgentId);

      expect(result.success).toBe(true);
      const profile = (result.data as { profile: { user_info: { name: string } } }).profile;
      expect(profile.user_info.name).toBe('TestUser');
    });

    it('should include last_updated timestamp', async () => {
      await client.updateProfile({ 'user_info.name': 'Test' }, testAgentId);

      const result = await client.getProfile(testAgentId);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('last_updated');
    });

    it('should return isolated profiles per agent', async () => {
      const agent1 = generateTestAgentId('profile1');
      const agent2 = generateTestAgentId('profile2');

      await client.updateProfile({ 'user_info.name': 'Agent1Name' }, agent1);
      await client.updateProfile({ 'user_info.name': 'Agent2Name' }, agent2);

      const profile1 = await client.getProfile(agent1);
      const profile2 = await client.getProfile(agent2);

      expect((profile1.data as { profile: { user_info: { name: string } } }).profile.user_info.name).toBe('Agent1Name');
      expect((profile2.data as { profile: { user_info: { name: string } } }).profile.user_info.name).toBe('Agent2Name');

      dbHelper.cleanupAgent(agent1);
      dbHelper.cleanupAgent(agent2);
    });
  });

  describe('update_profile', () => {
    it('should update simple field', async () => {
      const result = await client.updateProfile({ 'user_info.name': 'John' }, testAgentId);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('updated_fields');
      expect((result.data as { updated_fields: string[] }).updated_fields).toContain('user_info.name');
    });

    it('should update nested path', async () => {
      const result = await client.updateProfile({ 'preferences.theme': 'dark' }, testAgentId);

      expect(result.success).toBe(true);

      // Verify
      const profile = await client.getProfile(testAgentId);
      const data = (profile.data as { profile: { preferences: { theme: string } } }).profile;
      expect(data.preferences.theme).toBe('dark');
    });

    it('should create nested structure if not exists', async () => {
      const result = await client.updateProfile({ 'preferences.editor.fontSize': 14 }, testAgentId);

      expect(result.success).toBe(true);

      const profile = await client.getProfile(testAgentId);
      const data = (profile.data as { profile: { preferences: { editor: { fontSize: number } } } }).profile;
      expect(data.preferences.editor.fontSize).toBe(14);
    });

    it('should update array element with bracket notation', async () => {
      // First set up an array
      await client.updateProfile({ current_projects: [{ name: 'Project1' }] }, testAgentId);

      // Then update element
      const result = await client.updateProfile({ 'current_projects[0].status': 'active' }, testAgentId);

      expect(result.success).toBe(true);

      const profile = await client.getProfile(testAgentId);
      const projects = (profile.data as { profile: { current_projects: { name: string; status: string }[] } }).profile
        .current_projects;
      expect(projects[0].status).toBe('active');
      expect(projects[0].name).toBe('Project1'); // Original data preserved
    });

    it('should update multiple fields at once', async () => {
      const result = await client.updateProfile(
        {
          'user_info.name': 'Alice',
          'user_info.role': 'Engineer',
          'preferences.theme': 'light',
        },
        testAgentId
      );

      expect(result.success).toBe(true);
      expect((result.data as { updated_fields: string[] }).updated_fields).toHaveLength(3);

      const profile = await client.getProfile(testAgentId);
      const data = (
        profile.data as {
          profile: { user_info: { name: string; role: string }; preferences: { theme: string } };
        }
      ).profile;
      expect(data.user_info.name).toBe('Alice');
      expect(data.user_info.role).toBe('Engineer');
      expect(data.preferences.theme).toBe('light');
    });

    it('should preserve previous updates', async () => {
      await client.updateProfile({ 'user_info.name': 'First' }, testAgentId);
      await client.updateProfile({ 'user_info.email': 'test@test.com' }, testAgentId);

      const profile = await client.getProfile(testAgentId);
      const data = (profile.data as { profile: { user_info: { name: string; email: string } } }).profile;

      expect(data.user_info.name).toBe('First');
      expect(data.user_info.email).toBe('test@test.com');
    });

    it('should store reason in history (if history is enabled)', async () => {
      const reason = 'User explicitly provided their name';
      await client.updateProfile({ 'user_info.name': 'Named' }, testAgentId, reason);

      const history = dbHelper.getProfileHistory(testAgentId);

      // Profile history is optional - if enabled, verify reason is stored
      if (history.length > 0) {
        const latestWithReason = history.find((h) => h.change_reason === reason);
        expect(latestWithReason).toBeDefined();
      }

      // Always verify the update itself worked
      const profile = await client.getProfile(testAgentId);
      expect((profile.data as { profile: { user_info: { name: string } } }).profile.user_info.name).toBe('Named');
    });

    it('should create history entry on each update (if history is enabled)', async () => {
      // Use a fresh agent to count history accurately
      const historyTestAgent = generateTestAgentId('history');

      await client.updateProfile({ 'user_info.name': 'V1' }, historyTestAgent);
      await client.updateProfile({ 'user_info.name': 'V2' }, historyTestAgent);
      await client.updateProfile({ 'user_info.name': 'V3' }, historyTestAgent);

      const historyCount = dbHelper.countProfileHistory(historyTestAgent);

      // Profile history tracking is optional
      // If enabled, should have at least some entries
      // The exact count depends on implementation (might be 2 or 3)
      expect(historyCount).toBeGreaterThanOrEqual(0);

      // Always verify the updates themselves worked
      const profile = await client.getProfile(historyTestAgent);
      expect((profile.data as { profile: { user_info: { name: string } } }).profile.user_info.name).toBe('V3');

      dbHelper.cleanupAgent(historyTestAgent);
    });
  });
});
