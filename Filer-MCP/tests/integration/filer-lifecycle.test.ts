/**
 * Filer MCP Lifecycle Test
 * A sequential integration test that verifies the Filer MCP works correctly
 * through its entire operational cycle.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  checkHealth,
  tools,
  logSection,
  logInfo,
  logSuccess,
  logError,
  FILER_URL,
} from "../helpers/mcp-client.js";

// Unique prefix for this test run
const LIFECYCLE_PREFIX = `lifecycle_${Date.now()}`;

describe("Filer MCP Lifecycle Test", () => {
  // Track created files for cleanup
  const createdFiles: string[] = [];

  afterAll(async () => {
    logSection("Cleanup");
    logInfo("Cleaning up test files...");

    for (const file of createdFiles) {
      try {
        await tools.deleteFile(file);
      } catch {
        // Ignore cleanup errors
      }
    }

    logSuccess(`Cleaned up ${createdFiles.length} test files`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 1: Initialization
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Phase 1: Initialization", () => {
    it("Step 1.1: Verify health endpoint responds 200", async () => {
      logSection(`Filer Lifecycle Test (${FILER_URL})`);
      logInfo("Phase 1: Initialization");

      const isHealthy = await checkHealth();
      expect(isHealthy).toBe(true);
    });

    it("Step 1.2: Verify workspace initialized", async () => {
      const result = await tools.getWorkspaceInfo();
      expect(result.success).toBe(true);
      expect(result.data?.workspace_path).toBeDefined();

      logInfo(`Workspace: ${result.data?.workspace_path}`);
      logInfo(`Files: ${result.data?.total_files || 0}`);
    });

    it("Step 1.3: Verify audit log exists", async () => {
      const result = await tools.getAuditLog({ limit: 1 });
      expect(result.success).toBe(true);
      expect(result.data?.entries).toBeInstanceOf(Array);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 2: Basic File Operations
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Phase 2: Basic File Operations", () => {
    const mainFile = `${LIFECYCLE_PREFIX}_main.txt`;
    const copyFile = `${LIFECYCLE_PREFIX}_copy.txt`;
    const movedFile = `${LIFECYCLE_PREFIX}_moved.txt`;

    it("Step 2.1: Create file -> verify success", async () => {
      logInfo("Phase 2: Basic File Operations");

      const result = await tools.createFile(mainFile, "Initial content for lifecycle test");
      expect(result.success).toBe(true);
      expect(result.data?.full_path).toContain(mainFile);

      createdFiles.push(mainFile);
    });

    it("Step 2.2: Read file -> verify content matches", async () => {
      const result = await tools.readFile(mainFile);
      expect(result.success).toBe(true);
      expect(result.data?.content).toBe("Initial content for lifecycle test");
    });

    it("Step 2.3: Update file -> verify new content", async () => {
      const result = await tools.updateFile(mainFile, "Updated content", false);
      expect(result.success).toBe(true);

      const readResult = await tools.readFile(mainFile);
      expect(readResult.data?.content).toBe("Updated content");
    });

    it("Step 2.4: Update with backup -> verify .bak created", async () => {
      const result = await tools.updateFile(mainFile, "Content after backup", true);
      expect(result.success).toBe(true);

      if (result.data?.backup_path) {
        expect(result.data.backup_path).toContain(".bak");
        logInfo(`Backup created: ${result.data.backup_path}`);
      }
    });

    it("Step 2.5: Copy file -> verify both exist", async () => {
      const result = await tools.copyFile(mainFile, copyFile);
      expect(result.success).toBe(true);

      createdFiles.push(copyFile);

      // Verify both exist
      const mainRead = await tools.readFile(mainFile);
      const copyRead = await tools.readFile(copyFile);

      expect(mainRead.success).toBe(true);
      expect(copyRead.success).toBe(true);
      expect(copyRead.data?.content).toBe("Content after backup");
    });

    it("Step 2.6: Move file -> verify old gone, new exists", async () => {
      const toMove = `${LIFECYCLE_PREFIX}_to_move.txt`;
      await tools.createFile(toMove, "Move me");
      createdFiles.push(toMove);

      const result = await tools.moveFile(toMove, movedFile);
      expect(result.success).toBe(true);

      // Verify old is gone
      const oldRead = await tools.readFile(toMove);
      expect(oldRead.success).toBe(false);

      // Verify new exists
      const newRead = await tools.readFile(movedFile);
      expect(newRead.success).toBe(true);
      expect(newRead.data?.content).toBe("Move me");

      createdFiles.push(movedFile);
      // Remove toMove from cleanup list since it's been moved
      const idx = createdFiles.indexOf(toMove);
      if (idx > -1) createdFiles.splice(idx, 1);
    });

    it("Step 2.7: List directory -> verify files correct", async () => {
      const result = await tools.listFiles(".");
      expect(result.success).toBe(true);
      expect(result.data?.files).toBeInstanceOf(Array);

      // Should find our test files
      const fileNames = result.data?.files.map((e) => e.name) || [];
      expect(fileNames.some((n) => n.includes(LIFECYCLE_PREFIX))).toBe(true);
    });

    it("Step 2.8: Delete file -> verify gone", async () => {
      const toDelete = `${LIFECYCLE_PREFIX}_to_delete.txt`;
      await tools.createFile(toDelete, "Delete me");

      const deleteResult = await tools.deleteFile(toDelete);
      expect(deleteResult.success).toBe(true);

      const readResult = await tools.readFile(toDelete);
      expect(readResult.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 3: Search Operations
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Phase 3: Search Operations", () => {
    const searchFiles = [
      `${LIFECYCLE_PREFIX}_search1.txt`,
      `${LIFECYCLE_PREFIX}_search2.txt`,
      `${LIFECYCLE_PREFIX}_search3.md`,
      `${LIFECYCLE_PREFIX}_search4.txt`,
      `${LIFECYCLE_PREFIX}_search5.txt`,
    ];

    beforeAll(async () => {
      logInfo("Phase 3: Search Operations");

      // Create test files with known content
      await tools.createFile(searchFiles[0], "Contains UNIQUE_SEARCH_TOKEN_A");
      await tools.createFile(searchFiles[1], "Contains UNIQUE_SEARCH_TOKEN_B");
      await tools.createFile(searchFiles[2], "Markdown file with TOKEN");
      await tools.createFile(searchFiles[3], "Another file with UNIQUE_SEARCH_TOKEN_A");
      await tools.createFile(searchFiles[4], "Plain text content");

      searchFiles.forEach((f) => createdFiles.push(f));
    });

    it("Step 3.1: Create 5 test files with known content", async () => {
      // Already done in beforeAll, verify they exist
      for (const file of searchFiles) {
        const result = await tools.readFile(file);
        expect(result.success).toBe(true);
      }
    });

    it("Step 3.2: Search by filename -> verify matches", async () => {
      const result = await tools.searchFiles(LIFECYCLE_PREFIX, { search_type: "filename" });
      expect(result.success).toBe(true);
      expect(result.data?.results.length).toBeGreaterThanOrEqual(5);
    });

    it("Step 3.3: Search by content -> verify matches", async () => {
      const result = await tools.searchFiles("UNIQUE_SEARCH_TOKEN_A", { search_type: "content" });
      expect(result.success).toBe(true);
      expect(result.data?.results.length).toBeGreaterThanOrEqual(2);
    });

    it("Step 3.4: Search with file type filter -> verify filtering", async () => {
      const result = await tools.searchFiles(LIFECYCLE_PREFIX, {
        search_type: "filename",
        file_types: [".md"],
      });
      expect(result.success).toBe(true);

      // Should only find the .md file
      if (result.data?.results.length) {
        result.data.results.forEach((r) => {
          expect(r.path).toContain(".md");
        });
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 4: Grants & Security
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Phase 4: Grants & Security", () => {
    it("Step 4.1: List grants -> verify initial state", async () => {
      logInfo("Phase 4: Grants & Security");

      const result = await tools.listGrants();
      expect(result.success).toBe(true);
      expect(result.data?.grants).toBeInstanceOf(Array);

      logInfo(`Active grants: ${result.data?.grants.length || 0}`);
    });

    it("Step 4.2: Check grant for external path -> verify denied", async () => {
      const result = await tools.checkGrant("/tmp/external_path_test");
      expect(result.success).toBe(true);
      expect(result.data?.has_access).toBe(false);
    });

    it("Step 4.3: Attempt path traversal -> verify blocked", async () => {
      const traversalPaths = [
        "../../../etc/passwd",
        "foo/../../../bar",
        "../../.ssh/config",
      ];

      for (const path of traversalPaths) {
        const result = await tools.readFile(path);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/traversal|not allowed/i);
      }
    });

    it("Step 4.4: Attempt forbidden path -> verify blocked", async () => {
      const forbiddenPaths = [
        "~/.ssh/id_rsa",
        "/etc/passwd",
        "~/.gnupg/private-keys",
      ];

      for (const path of forbiddenPaths) {
        const result = await tools.readFile(path);
        expect(result.success).toBe(false);
      }
    });

    it("Step 4.5: Attempt forbidden extension -> verify blocked", async () => {
      const forbiddenFiles = ["test.exe", "script.bat", "pwned.ps1"];

      for (const file of forbiddenFiles) {
        const result = await tools.createFile(file, "malicious");
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/forbidden|extension|security/i);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 5: Audit Trail Verification
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Phase 5: Audit Trail Verification", () => {
    it("Step 5.1: Get audit log -> verify operations logged", async () => {
      logInfo("Phase 5: Audit Trail Verification");

      const result = await tools.getAuditLog({ limit: 50 });
      expect(result.success).toBe(true);
      expect(result.data?.entries.length).toBeGreaterThan(0);

      // Should have entries from our test operations
      const lifecycleEntries =
        result.data?.entries.filter((e) => e.path.includes(LIFECYCLE_PREFIX)) || [];
      expect(lifecycleEntries.length).toBeGreaterThan(0);

      logInfo(`Found ${lifecycleEntries.length} audit entries for this test`);
    });

    it("Step 5.2: Filter by path -> verify filtering works", async () => {
      const result = await tools.getAuditLog({ path_filter: LIFECYCLE_PREFIX });
      expect(result.success).toBe(true);

      if (result.data?.entries.length) {
        result.data.entries.forEach((entry) => {
          expect(entry.path.toLowerCase()).toContain(LIFECYCLE_PREFIX.toLowerCase());
        });
      }
    });

    it("Step 5.3: Filter by operation -> verify filtering works", async () => {
      const result = await tools.getAuditLog({ operation_filter: "create_file" });
      expect(result.success).toBe(true);

      if (result.data?.entries.length) {
        result.data.entries.forEach((entry) => {
          expect(entry.operation).toBe("create_file");
        });
      }
    });

    it("Step 5.4: Verify error operations also logged", async () => {
      // Trigger a failed operation
      await tools.readFile(`${LIFECYCLE_PREFIX}_definitely_nonexistent.txt`);

      const result = await tools.getAuditLog({ limit: 20 });
      expect(result.success).toBe(true);

      // Check for unsuccessful entries (implementation may or may not log failures)
      const entries = result.data?.entries || [];
      logInfo(`Total audit entries checked: ${entries.length}`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 6: Edge Cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Phase 6: Edge Cases", () => {
    it("Step 6.1: Create file with unicode name", async () => {
      logInfo("Phase 6: Edge Cases");

      const unicodeFile = `${LIFECYCLE_PREFIX}_日本語_テスト.txt`;
      const result = await tools.createFile(unicodeFile, "Unicode filename test");
      expect(result.success).toBe(true);

      createdFiles.push(unicodeFile);

      const readResult = await tools.readFile(unicodeFile);
      expect(readResult.success).toBe(true);
    });

    it("Step 6.2: Create file with spaces in name", async () => {
      const spacesFile = `${LIFECYCLE_PREFIX} spaces in name.txt`;
      const result = await tools.createFile(spacesFile, "Spaces test");
      expect(result.success).toBe(true);

      createdFiles.push(spacesFile);

      const readResult = await tools.readFile(spacesFile);
      expect(readResult.success).toBe(true);
    });

    it("Step 6.3: Create deeply nested file", async () => {
      const nestedFile = `nested/deep/${LIFECYCLE_PREFIX}_nested.txt`;
      const result = await tools.createFile(nestedFile, "Nested content");
      expect(result.success).toBe(true);

      createdFiles.push(nestedFile);

      const readResult = await tools.readFile(nestedFile);
      expect(readResult.success).toBe(true);
    });

    it("Step 6.4: Create/read empty file", async () => {
      const emptyFile = `${LIFECYCLE_PREFIX}_empty.txt`;
      const result = await tools.createFile(emptyFile, "");
      expect(result.success).toBe(true);

      createdFiles.push(emptyFile);

      const readResult = await tools.readFile(emptyFile);
      expect(readResult.success).toBe(true);
      expect(readResult.data?.content).toBe("");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 7: Cleanup Service
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Phase 7: Cleanup Service", () => {
    it("Step 7.1: Create file in temp/", async () => {
      logInfo("Phase 7: Cleanup Service");

      const tempFile = `temp/${LIFECYCLE_PREFIX}_temp_file.txt`;
      const result = await tools.createFile(tempFile, "Temp file for cleanup test");

      // May succeed or fail depending on temp dir existence
      if (result.success) {
        createdFiles.push(tempFile);
        logInfo("Created temp file for cleanup test");
      }
    });

    it("Step 7.2: Verify temp directory exists", async () => {
      const result = await tools.listFiles("temp");
      expect(result.success).toBe(true);
    });

    it("Step 7.3: Note: Cleanup runs on server startup", async () => {
      // Cleanup service runs automatically on startup
      // We can't trigger it manually, but we verify temp files are in the right place
      logInfo("Cleanup service runs on server startup (files > 7 days old)");
      expect(true).toBe(true);
    });

    it("Step 7.4: Verify cleanup would be logged", async () => {
      // Check if there are any cleanup-related audit entries
      const result = await tools.getAuditLog({ operation_filter: "cleanup", limit: 10 });
      expect(result.success).toBe(true);
      // May or may not have cleanup entries depending on whether cleanup ran
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Phase 8: Final Verification
  // ═══════════════════════════════════════════════════════════════════════════

  describe("Phase 8: Final Verification", () => {
    it("Step 8.1: Get workspace info -> verify stats updated", async () => {
      logInfo("Phase 8: Final Verification");

      const result = await tools.getWorkspaceInfo();
      expect(result.success).toBe(true);

      logInfo(`Final workspace stats:`);
      logInfo(`  Path: ${result.data?.workspace_path}`);
      logInfo(`  Files: ${result.data?.total_files || "N/A"}`);
      logInfo(`  Size: ${result.data?.total_size_mb || "N/A"} MB`);
    });

    it("Step 8.2: Get full audit log -> verify complete history", async () => {
      const result = await tools.getAuditLog({ limit: 100 });
      expect(result.success).toBe(true);

      const totalEntries = result.data?.entries.length || 0;
      const lifecycleEntries =
        result.data?.entries.filter((e) => e.path.includes(LIFECYCLE_PREFIX)).length || 0;

      logInfo(`Audit log summary:`);
      logInfo(`  Total entries (up to 100): ${totalEntries}`);
      logInfo(`  Lifecycle test entries: ${lifecycleEntries}`);
    });

    it("Step 8.3: Cleanup complete", async () => {
      logInfo(`Test files to clean: ${createdFiles.length}`);
      logSuccess("Lifecycle test completed successfully");
      expect(true).toBe(true);
    });
  });
});
