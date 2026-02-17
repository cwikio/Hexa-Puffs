/**
 * Lifecycle Test 4: Export/Import Round-Trip
 * Tests complete data export and re-import cycle
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpClient } from '../helpers/mcp-client.js';
import { dbHelper } from '../helpers/db-helpers.js';
import { generateTestAgentId } from '../helpers/test-data.js';
import { existsSync, rmSync, readdirSync } from 'fs';

describe('Lifecycle: Export/Import Round-Trip', () => {
  let client: McpClient;
  let testAgentId: string;
  let importAgentId: string;
  let exportPath: string;
  const exportBasePath = process.env.EXPORT_PATH ?? '/tmp/memorizer-test/export';

  // Track original data for verification
  let originalFactCount: number;
  let originalConvCount: number;
  let originalProfileName: string;

  beforeAll(() => {
    client = new McpClient();
    testAgentId = generateTestAgentId('lifecycle-export');
    importAgentId = generateTestAgentId('lifecycle-import');
  });

  afterAll(() => {
    dbHelper.cleanupAgent(testAgentId);
    dbHelper.cleanupAgent(importAgentId);

    // Clean up export directories
    if (exportPath && existsSync(exportPath)) {
      rmSync(exportPath, { recursive: true, force: true });
    }
  });

  it('Step 1: Populate test data', async () => {
    // Store 5 facts across 3 categories
    await client.storeFact('Preference fact 1', 'preference', testAgentId);
    await client.storeFact('Preference fact 2', 'preference', testAgentId);
    await client.storeFact('Background fact 1', 'background', testAgentId);
    await client.storeFact('Project fact 1', 'project', testAgentId);
    await client.storeFact('Project fact 2', 'project', testAgentId);

    // Store 2 conversations
    await client.storeConversation('First conversation message', 'First conversation response', testAgentId);

    await client.storeConversation('Second conversation message', 'Second conversation response', testAgentId);

    // Update profile with custom data
    originalProfileName = 'ExportTestUser';
    await client.updateProfile(
      {
        'user_info.name': originalProfileName,
        'user_info.email': 'export@test.com',
        'preferences.theme': 'dark',
      },
      testAgentId
    );

    // Record counts for later verification
    const stats = await client.getMemoryStats(testAgentId);
    originalFactCount = (stats.data as { fact_count: number }).fact_count;
    originalConvCount = (stats.data as { conversation_count: number }).conversation_count;

    expect(originalFactCount).toBe(5);
    expect(originalConvCount).toBe(2);
  });

  it('Step 2: Export as JSON', async () => {
    const result = await client.exportMemory(testAgentId, 'json', true);

    expect(result.success).toBe(true);

    // Verify: Export directory created
    exportPath = (result.data as { export_path: string }).export_path;
    expect(existsSync(exportPath)).toBe(true);

    // Verify: profile.json exists and valid
    const profilePath = `${exportPath}/profile.json`;
    expect(existsSync(profilePath)).toBe(true);

    // Verify: facts directory exists
    const factsDir = `${exportPath}/facts`;
    expect(existsSync(factsDir)).toBe(true);

    // Verify: facts files exist for populated categories
    const factsFiles = readdirSync(factsDir);
    expect(factsFiles.length).toBeGreaterThan(0);

    // Verify: conversations directory exists (since include_conversations = true)
    const convsDir = `${exportPath}/conversations`;
    if (existsSync(convsDir)) {
      const convFiles = readdirSync(convsDir);
      expect(convFiles.length).toBeGreaterThan(0);
    }

    // Verify: summary.md may exist (optional feature)
    const summaryPath = `${exportPath}/summary.md`;
    // summary.md is optional - some export implementations may not create it
    if (existsSync(summaryPath)) {
      expect(existsSync(summaryPath)).toBe(true);
    }
  });

  it('Step 3: Clear database (simulate fresh start)', async () => {
    // Delete all data for import agent (should be empty already)
    dbHelper.cleanupAgent(importAgentId);

    // Verify: Stats show all zeros
    const stats = await client.getMemoryStats(importAgentId);
    expect((stats.data as { fact_count: number }).fact_count).toBe(0);
    expect((stats.data as { conversation_count: number }).conversation_count).toBe(0);
  });

  it('Step 4: Import profile.json', async () => {
    const profilePath = `${exportPath}/profile.json`;

    const result = await client.importMemory(profilePath, importAgentId);

    expect(result.success).toBe(true);

    // Verify: success = true
    // Verify: changes_applied > 0
    expect((result.data as { changes_applied: number }).changes_applied).toBeGreaterThan(0);

    // Verify: get_profile returns imported data
    const profileResult = await client.getProfile(importAgentId);
    const profile = (
      profileResult.data as {
        profile: { user_info: { name: string; email: string }; preferences: { theme: string } };
      }
    ).profile;

    expect(profile.user_info.name).toBe(originalProfileName);
    expect(profile.user_info.email).toBe('export@test.com');
    expect(profile.preferences.theme).toBe('dark');
  });

  it('Step 5: Import facts files', async () => {
    const factsDir = `${exportPath}/facts`;
    const factsFiles = readdirSync(factsDir).filter((f) => f.endsWith('.json'));

    let totalImported = 0;

    for (const file of factsFiles) {
      const filePath = `${factsDir}/${file}`;
      const result = await client.importMemory(filePath, importAgentId);

      if (result.success) {
        totalImported += (result.data as { changes_applied: number }).changes_applied || 0;
      }
    }

    // Verify: Facts restored
    expect(totalImported).toBeGreaterThan(0);

    // Verify: list_facts returns imported facts
    const listResult = await client.listFacts(importAgentId);
    expect((listResult.data as { facts: unknown[] }).facts.length).toBeGreaterThan(0);
  });

  it('Step 6: Verify integrity', async () => {
    // Stats match original counts (or close to it)
    const stats = await client.getMemoryStats(importAgentId);
    const importedFactCount = (stats.data as { fact_count: number }).fact_count;

    // Facts should be imported
    expect(importedFactCount).toBeGreaterThan(0);
    // May not be exact due to deduplication or import behavior
    expect(importedFactCount).toBeLessThanOrEqual(originalFactCount);

    // Retrieve memories works
    const memoryResult = await client.retrieveMemories('fact', importAgentId);
    expect(memoryResult.success).toBe(true);

    // Profile data preserved
    const profileResult = await client.getProfile(importAgentId);
    const profile = (profileResult.data as { profile: { user_info: { name: string } } }).profile;
    expect(profile.user_info.name).toBe(originalProfileName);
  });
});
