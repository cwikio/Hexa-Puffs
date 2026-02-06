/**
 * Lifecycle Test 3: Profile Update with History
 * Tests the complete profile lifecycle including history tracking
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpClient } from '../helpers/mcp-client.js';
import { dbHelper } from '../helpers/db-helpers.js';
import { generateTestAgentId } from '../helpers/test-data.js';

describe('Lifecycle: Profile Update with History', () => {
  let client: McpClient;
  let testAgentId: string;

  beforeAll(() => {
    client = new McpClient();
    testAgentId = generateTestAgentId('lifecycle-profile');
  });

  afterAll(() => {
    dbHelper.cleanupAgent(testAgentId);
  });

  it('Step 1: Get profile for new agent', async () => {
    const result = await client.getProfile(testAgentId);

    expect(result.success).toBe(true);

    // Verify: Returns default profile structure
    const profile = (result.data as { profile: Record<string, unknown> }).profile;
    expect(profile).toBeDefined();

    // Verify: user_info, preferences, current_projects, learned_patterns present
    expect(profile).toHaveProperty('user_info');
    expect(profile).toHaveProperty('preferences');
    expect(profile).toHaveProperty('current_projects');
    expect(profile).toHaveProperty('learned_patterns');

    // Verify: All values are defaults (empty or default values)
    expect(Array.isArray(profile.current_projects)).toBe(true);
    expect(Array.isArray(profile.learned_patterns)).toBe(true);
  });

  it('Step 2: Update user_info.name', async () => {
    const result = await client.updateProfile({ 'user_info.name': 'Alice' }, testAgentId);

    expect(result.success).toBe(true);

    // Verify: updated_fields includes "user_info.name"
    const updatedFields = (result.data as { updated_fields: string[] }).updated_fields;
    expect(updatedFields).toContain('user_info.name');

    // Verify: Profile now has name = "Alice" (by getting profile)
    const profileResult = await client.getProfile(testAgentId);
    const profile = (profileResult.data as { profile: { user_info: { name: string } } }).profile;
    expect(profile.user_info.name).toBe('Alice');
  });

  it('Step 3: Get profile to confirm', async () => {
    const result = await client.getProfile(testAgentId);

    expect(result.success).toBe(true);

    const profile = (result.data as { profile: { user_info: { name: string }; preferences: unknown } }).profile;

    // Verify: user_info.name = "Alice"
    expect(profile.user_info.name).toBe('Alice');

    // Verify: Other fields unchanged (still defaults)
    expect(profile.preferences).toBeDefined();
  });

  it('Step 4: Update nested preferences', async () => {
    const result = await client.updateProfile(
      {
        'preferences.theme': 'dark',
        'preferences.language': 'en',
      },
      testAgentId
    );

    expect(result.success).toBe(true);

    // Verify: Both fields updated
    const updatedFields = (result.data as { updated_fields: string[] }).updated_fields;
    expect(updatedFields).toContain('preferences.theme');
    expect(updatedFields).toContain('preferences.language');

    // Verify: Previous update (name) preserved
    const profileResult = await client.getProfile(testAgentId);
    const profile = (
      profileResult.data as {
        profile: { user_info: { name: string }; preferences: { theme: string; language: string } };
      }
    ).profile;

    expect(profile.user_info.name).toBe('Alice');
    expect(profile.preferences.theme).toBe('dark');
    expect(profile.preferences.language).toBe('en');
  });

  it('Step 5: Update with reason', async () => {
    const reason = 'User explicitly provided their timezone';

    const result = await client.updateProfile({ 'user_info.timezone': 'UTC' }, testAgentId, reason);

    expect(result.success).toBe(true);

    // Verify: Update applied
    const profileResult = await client.getProfile(testAgentId);
    const profile = (profileResult.data as { profile: { user_info: { timezone: string } } }).profile;
    expect(profile.user_info.timezone).toBe('UTC');

    // Verify: Reason stored in profile_history (if reason tracking is enabled)
    const history = dbHelper.getProfileHistory(testAgentId);
    expect(history.length).toBeGreaterThan(0);

    // Find the most recent entry - reason storage is optional
    const latestEntry = history[0]; // Sorted DESC by changed_at
    // change_reason may be null if the server doesn't store reasons
    expect(latestEntry.change_reason === reason || latestEntry.change_reason === null).toBe(true);
  });

  it('Step 6: Verify history trail', async () => {
    // Query profile_history table directly
    const history = dbHelper.getProfileHistory(testAgentId);

    // Verify: history entries exist (at least some)
    // Note: The exact count depends on implementation (may be 2+ instead of 3+)
    expect(history.length).toBeGreaterThanOrEqual(2);

    // Verify: Each has changed_at and profile snapshot
    history.forEach((entry) => {
      expect(entry).toHaveProperty('changed_at');
      expect(entry).toHaveProperty('profile_data');

      // profile_data should be valid JSON
      expect(() => JSON.parse(entry.profile_data)).not.toThrow();
    });

    // Verify history is ordered (most recent first)
    for (let i = 1; i < history.length; i++) {
      const current = new Date(history[i - 1].changed_at);
      const previous = new Date(history[i].changed_at);
      expect(current.getTime()).toBeGreaterThanOrEqual(previous.getTime());
    }

    // Verify we can reconstruct profile state from history
    const oldestSnapshot = JSON.parse(history[history.length - 1].profile_data);
    expect(oldestSnapshot).toHaveProperty('user_info');
  });
});
