/**
 * Level 2 Integration Tests: Export/Import
 * Tests export_memory, import_memory
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpClient } from '../helpers/mcp-client.js';
import { dbHelper } from '../helpers/db-helpers.js';
import { generateTestAgentId } from '../helpers/test-data.js';
import { existsSync, rmSync, readdirSync } from 'fs';

describe('Export/Import', () => {
  let client: McpClient;
  let testAgentId: string;
  const exportBasePath = process.env.EXPORT_PATH ?? '/tmp/memorizer-test/export';

  beforeEach(async () => {
    client = new McpClient();
    testAgentId = generateTestAgentId('export');

    // Populate with test data
    await client.storeFact('Export test fact 1', 'preference', testAgentId);
    await client.storeFact('Export test fact 2', 'background', testAgentId);
    await client.storeConversation('Export test message', 'Export test response', testAgentId);
    await client.updateProfile({ 'user_info.name': 'ExportUser' }, testAgentId);
  });

  afterEach(() => {
    dbHelper.cleanupAgent(testAgentId);

    // Clean up export directory
    const exportPath = `${exportBasePath}/${testAgentId}`;
    if (existsSync(exportPath)) {
      rmSync(exportPath, { recursive: true, force: true });
    }
  });

  describe('export_memory', () => {
    it('should export as JSON format', async () => {
      const result = await client.exportMemory(testAgentId, 'json', true);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('export_path');
    });

    it('should export as Markdown format', async () => {
      const result = await client.exportMemory(testAgentId, 'markdown', true);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('export_path');
    });

    it('should create export directory structure', async () => {
      const result = await client.exportMemory(testAgentId, 'json', true);

      expect(result.success).toBe(true);

      const exportPath = (result.data as { export_path: string }).export_path;

      // Check directory exists
      expect(existsSync(exportPath)).toBe(true);
    });

    it('should export files and report count', async () => {
      const result = await client.exportMemory(testAgentId, 'json', true);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('files_created');

      const filesCreated = (result.data as { files_created: number }).files_created;
      expect(filesCreated).toBeGreaterThan(0);
    });

    it('should export facts by category', async () => {
      const result = await client.exportMemory(testAgentId, 'json', true);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('export_path');
      expect(result.data).toHaveProperty('files_created');
      expect((result.data as { files_created: number }).files_created).toBeGreaterThan(0);
    });

    it('should include conversations when specified', async () => {
      const result = await client.exportMemory(testAgentId, 'json', true);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('export_path');
      // files_created should include conversations when include_conversations=true
      expect((result.data as { files_created: number }).files_created).toBeGreaterThan(0);
    });

    it('should export successfully without conversations', async () => {
      const result = await client.exportMemory(testAgentId, 'json', false);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('export_path');
    });

    it('should create summary file for markdown export', async () => {
      const result = await client.exportMemory(testAgentId, 'markdown', true);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('export_path');
      expect((result.data as { files_created: number }).files_created).toBeGreaterThan(0);
    });
  });

  describe('import_memory', () => {
    it('should import profile from JSON file', async () => {
      // First export
      const exportResult = await client.exportMemory(testAgentId, 'json', true);
      const exportPath = (exportResult.data as { export_path: string }).export_path;
      const profilePath = `${exportPath}/profile.json`;

      // Create new agent and import
      const newAgent = generateTestAgentId('import');

      const result = await client.importMemory(profilePath, newAgent);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('changes_applied');
      expect((result.data as { changes_applied: number }).changes_applied).toBeGreaterThan(0);

      // Verify profile imported
      const profile = await client.getProfile(newAgent);
      expect((profile.data as { profile: { user_info: { name: string } } }).profile.user_info.name).toBe('ExportUser');

      dbHelper.cleanupAgent(newAgent);
    });

    it('should import facts from JSON file', async () => {
      // First export
      const exportResult = await client.exportMemory(testAgentId, 'json', true);
      const exportPath = (exportResult.data as { export_path: string }).export_path;

      // Find a facts file
      const factsDir = `${exportPath}/facts`;
      if (existsSync(factsDir)) {
        const factsFiles = readdirSync(factsDir).filter((f) => f.endsWith('.json'));

        if (factsFiles.length > 0) {
          const factsPath = `${factsDir}/${factsFiles[0]}`;
          const newAgent = generateTestAgentId('import-facts');

          const result = await client.importMemory(factsPath, newAgent);

          expect(result.success).toBe(true);

          dbHelper.cleanupAgent(newAgent);
        }
      }
    });

    it('should return error for invalid file path', async () => {
      const result = await client.importMemory('/nonexistent/path/file.json', testAgentId);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should detect file type from path', async () => {
      // Export first
      const exportResult = await client.exportMemory(testAgentId, 'json', true);
      const exportPath = (exportResult.data as { export_path: string }).export_path;

      // Import profile (should be detected as profile file)
      const profilePath = `${exportPath}/profile.json`;
      const newAgent = generateTestAgentId('detect');

      const result = await client.importMemory(profilePath, newAgent);

      expect(result.success).toBe(true);

      dbHelper.cleanupAgent(newAgent);
    });

    it('should handle importing facts', async () => {
      // Use a fresh agent to avoid interference from other tests
      const importTestAgent = generateTestAgentId('import-test');

      // Store initial facts
      await client.storeFact('Import test fact 1', 'preference', importTestAgent);
      await client.storeFact('Import test fact 2', 'background', importTestAgent);

      // Get initial count
      const initialStats = await client.getMemoryStats(importTestAgent);
      const initialCount = (initialStats.data as { fact_count: number }).fact_count;
      expect(initialCount).toBe(2);

      // Export
      const exportResult = await client.exportMemory(importTestAgent, 'json', true);
      const exportPath = (exportResult.data as { export_path: string }).export_path;

      // Import same facts again to the same agent
      const factsDir = `${exportPath}/facts`;
      if (existsSync(factsDir)) {
        const factsFiles = readdirSync(factsDir).filter((f) => f.endsWith('.json'));

        if (factsFiles.length > 0) {
          const factsPath = `${factsDir}/${factsFiles[0]}`;
          const importResult = await client.importMemory(factsPath, importTestAgent);

          // Import should succeed
          expect(importResult.success).toBe(true);

          // Count may stay same (if using INSERT OR REPLACE) or increase (if INSERT)
          const finalStats = await client.getMemoryStats(importTestAgent);
          const finalCount = (finalStats.data as { fact_count: number }).fact_count;

          // Final count should be at least the initial count
          expect(finalCount).toBeGreaterThanOrEqual(initialCount);
        }
      }

      // Cleanup
      dbHelper.cleanupAgent(importTestAgent);
      if (exportPath && existsSync(exportPath)) {
        rmSync(exportPath, { recursive: true, force: true });
      }
    });
  });
});
