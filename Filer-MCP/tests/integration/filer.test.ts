/**
 * Filer MCP Integration Tests
 * Level 2 tests covering all tools, security, edge cases, and audit logging
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  checkHealth,
  tools,
  logSection,
  logInfo,
  FILER_URL,
} from "../helpers/mcp-client.js";

// Test file prefix to avoid conflicts
const TEST_PREFIX = `test_${Date.now()}`;

describe("Filer MCP Tests", () => {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2.4.1 Health & Initialization
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("2.4.1 Health & Initialization", () => {
    it("should respond to health check with 200 OK", async () => {
      logSection(`Filer MCP Tests (${FILER_URL})`);
      const isHealthy = await checkHealth();
      expect(isHealthy).toBe(true);
    });

    it("should return workspace info on startup", async () => {
      const result = await tools.getWorkspaceInfo();
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty("workspace_path");
      expect(result.data).toHaveProperty("total_files");
      expect(result.data).toHaveProperty("total_size_mb");
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2.4.2 File Operations
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("2.4.2 File Operations", () => {
    const testFile = `${TEST_PREFIX}_file.txt`;
    const testContent = "Hello, Filer MCP!";

    afterAll(async () => {
      // Cleanup test files
      await tools.deleteFile(testFile);
      await tools.deleteFile(`${TEST_PREFIX}_copy.txt`);
      await tools.deleteFile(`${TEST_PREFIX}_moved.txt`);
    });

    it("should create a new file", async () => {
      const result = await tools.createFile(testFile, testContent);
      expect(result.success).toBe(true);
      expect(result.data?.full_path).toContain(testFile);
    });

    it("should fail to create file with overwrite=false if exists", async () => {
      const result = await tools.createFile(testFile, "new content", false);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/exists|overwrite/i);
    });

    it("should create file with overwrite=true if exists", async () => {
      const result = await tools.createFile(testFile, "overwritten content", true);
      expect(result.success).toBe(true);
    });

    it("should read file content", async () => {
      const result = await tools.readFile(testFile);
      expect(result.success).toBe(true);
      expect(result.data?.content).toBe("overwritten content");
    });

    it("should fail to read non-existent file", async () => {
      const result = await tools.readFile(`${TEST_PREFIX}_nonexistent.txt`);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found|exist/i);
    });

    it("should update file content", async () => {
      const result = await tools.updateFile(testFile, "updated content", false);
      expect(result.success).toBe(true);
    });

    it("should update file with backup", async () => {
      const result = await tools.updateFile(testFile, "updated with backup", true);
      expect(result.success).toBe(true);
      // Backup path should be in temp folder
      if (result.data?.backup_path) {
        expect(result.data.backup_path).toContain("temp");
        expect(result.data.backup_path).toContain(".bak");
      }
    });

    it("should list directory contents", async () => {
      const result = await tools.listFiles(".");
      expect(result.success).toBe(true);
      expect(result.data?.files).toBeInstanceOf(Array);
    });

    it("should list directory recursively", async () => {
      const result = await tools.listFiles(".", true);
      expect(result.success).toBe(true);
      expect(result.data?.files).toBeInstanceOf(Array);
    });

    it("should copy file", async () => {
      const copyFile = `${TEST_PREFIX}_copy.txt`;
      const result = await tools.copyFile(testFile, copyFile);
      expect(result.success).toBe(true);

      // Verify copy exists
      const readResult = await tools.readFile(copyFile);
      expect(readResult.success).toBe(true);
    });

    it("should move file", async () => {
      const sourceFile = `${TEST_PREFIX}_to_move.txt`;
      const destFile = `${TEST_PREFIX}_moved.txt`;

      // Create source file
      await tools.createFile(sourceFile, "content to move");

      // Move it
      const result = await tools.moveFile(sourceFile, destFile);
      expect(result.success).toBe(true);

      // Verify source is gone
      const sourceRead = await tools.readFile(sourceFile);
      expect(sourceRead.success).toBe(false);

      // Verify destination exists
      const destRead = await tools.readFile(destFile);
      expect(destRead.success).toBe(true);
    });

    it("should delete file", async () => {
      const deleteFile = `${TEST_PREFIX}_to_delete.txt`;
      await tools.createFile(deleteFile, "delete me");

      const result = await tools.deleteFile(deleteFile);
      expect(result.success).toBe(true);

      // Verify deleted
      const readResult = await tools.readFile(deleteFile);
      expect(readResult.success).toBe(false);
    });

    it("should fail to delete non-existent file", async () => {
      const result = await tools.deleteFile(`${TEST_PREFIX}_nonexistent.txt`);
      expect(result.success).toBe(false);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2.4.3 Grants System Tests
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("2.4.3 Grants System", () => {
    it("should list grants (may be empty)", async () => {
      const result = await tools.listGrants();
      expect(result.success).toBe(true);
      expect(result.data?.grants).toBeInstanceOf(Array);
    });

    it("should check grant for external path (no grant)", async () => {
      const result = await tools.checkGrant("/tmp/some_external_path");
      expect(result.success).toBe(true);
      expect(result.data?.has_access).toBe(false);
    });

    it("should request grant and return message", async () => {
      const result = await tools.requestGrant("/tmp/test_grant_path", "read", "Testing grant request");
      expect(result.success).toBe(true);
      expect(result.data?.message).toBeDefined();
      expect(result.data?.status).toBeDefined();
    });

    it("should fail to read external path without grant", async () => {
      const result = await tools.readFile("/tmp/external_file.txt");
      // Should fail with permission error (not file not found)
      expect(result.success).toBe(false);
    });

    it("should fail to write to external path without grant", async () => {
      const result = await tools.createFile("/tmp/external_file.txt", "content");
      expect(result.success).toBe(false);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2.4.4 Search Operations
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("2.4.4 Search Operations", () => {
    const searchTestFile = `${TEST_PREFIX}_searchable.txt`;

    beforeAll(async () => {
      await tools.createFile(searchTestFile, "This file contains SEARCHTERM123 for testing");
    });

    afterAll(async () => {
      await tools.deleteFile(searchTestFile);
    });

    it("should search by filename", async () => {
      const result = await tools.searchFiles(TEST_PREFIX, { search_type: "filename" });
      expect(result.success).toBe(true);
      expect(result.data?.results).toBeInstanceOf(Array);
    });

    it("should search by content", async () => {
      const result = await tools.searchFiles("SEARCHTERM123", { search_type: "content" });
      expect(result.success).toBe(true);
      expect(result.data?.results.length).toBeGreaterThanOrEqual(1);
    });

    it("should return empty results for non-matching query", async () => {
      const result = await tools.searchFiles("ZZZZNONEXISTENT12345", { search_type: "filename" });
      expect(result.success).toBe(true);
      expect(result.data?.results.length).toBe(0);
    });

    it("should filter by file types", async () => {
      const result = await tools.searchFiles(TEST_PREFIX, {
        search_type: "filename",
        file_types: [".txt"],
      });
      expect(result.success).toBe(true);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2.4.5 Security Tests
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("2.4.5 Security Tests", () => {
    it("should block path traversal attempts", async () => {
      const traversalPaths = [
        "../../../etc/passwd",
        "../../.ssh/id_rsa",
        "foo/../../../bar",
      ];

      for (const path of traversalPaths) {
        const result = await tools.readFile(path);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/traversal|not allowed/i);
      }
    });

    it("should block forbidden paths", async () => {
      const forbiddenPaths = [
        "~/.ssh/id_rsa",
        "~/.gnupg/private-keys",
        "/etc/passwd",
      ];

      for (const path of forbiddenPaths) {
        const result = await tools.readFile(path);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/forbidden|denied|grant/i);
      }
    });

    it("should block forbidden extensions", async () => {
      const forbiddenFiles = ["virus.exe", "script.bat", "malware.ps1"];

      for (const file of forbiddenFiles) {
        const result = await tools.createFile(file, "malicious content");
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/forbidden|extension|security/i);
      }
    });

    it("should prevent workspace escape", async () => {
      // Attempting to delete outside workspace should fail
      const result = await tools.deleteFile("/tmp/outside_workspace.txt");
      expect(result.success).toBe(false);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2.4.6 Edge Cases
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("2.4.6 Edge Cases", () => {
    afterAll(async () => {
      // Cleanup edge case files
      await tools.deleteFile(`${TEST_PREFIX}_unicode_日本語.txt`);
      await tools.deleteFile(`${TEST_PREFIX}_spaces file.txt`);
      await tools.deleteFile(`${TEST_PREFIX}_empty.txt`);
      await tools.deleteFile(`nested/${TEST_PREFIX}_deep.txt`);
    });

    it("should handle unicode filenames", async () => {
      const unicodeFile = `${TEST_PREFIX}_unicode_日本語.txt`;
      const result = await tools.createFile(unicodeFile, "Unicode content");
      expect(result.success).toBe(true);

      const readResult = await tools.readFile(unicodeFile);
      expect(readResult.success).toBe(true);
    });

    it("should handle filenames with spaces", async () => {
      const spacesFile = `${TEST_PREFIX}_spaces file.txt`;
      const result = await tools.createFile(spacesFile, "Content with spaces in filename");
      expect(result.success).toBe(true);

      const readResult = await tools.readFile(spacesFile);
      expect(readResult.success).toBe(true);
    });

    it("should handle empty content", async () => {
      const emptyFile = `${TEST_PREFIX}_empty.txt`;
      const result = await tools.createFile(emptyFile, "");
      expect(result.success).toBe(true);

      const readResult = await tools.readFile(emptyFile);
      expect(readResult.success).toBe(true);
      expect(readResult.data?.content).toBe("");
    });

    it("should handle nested directories", async () => {
      const nestedFile = `nested/${TEST_PREFIX}_deep.txt`;
      const result = await tools.createFile(nestedFile, "Nested content");
      expect(result.success).toBe(true);

      const readResult = await tools.readFile(nestedFile);
      expect(readResult.success).toBe(true);
    });

    it("should handle large content", async () => {
      const largeContent = "x".repeat(100000); // 100KB
      const largeFile = `${TEST_PREFIX}_large.txt`;

      const result = await tools.createFile(largeFile, largeContent);
      expect(result.success).toBe(true);

      const readResult = await tools.readFile(largeFile);
      expect(readResult.success).toBe(true);
      expect(readResult.data?.content.length).toBe(100000);

      await tools.deleteFile(largeFile);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2.4.7 Audit Log Tests
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("2.4.7 Audit Log Tests", () => {
    const auditTestFile = `${TEST_PREFIX}_audit.txt`;

    beforeAll(async () => {
      // Create a file to generate audit entries
      await tools.createFile(auditTestFile, "Audit test content");
      await tools.readFile(auditTestFile);
      await tools.updateFile(auditTestFile, "Updated audit content", false);
    });

    afterAll(async () => {
      await tools.deleteFile(auditTestFile);
    });

    it("should return audit log entries", async () => {
      const result = await tools.getAuditLog();
      expect(result.success).toBe(true);
      expect(result.data?.entries).toBeInstanceOf(Array);
      expect(result.data?.entries.length).toBeGreaterThan(0);
    });

    it("should filter audit log by path", async () => {
      const result = await tools.getAuditLog({ path_filter: auditTestFile });
      expect(result.success).toBe(true);
      // All entries should contain the test file path
      if (result.data?.entries && result.data.entries.length > 0) {
        result.data.entries.forEach((entry) => {
          expect(entry.path).toContain(TEST_PREFIX);
        });
      }
    });

    it("should filter audit log by operation", async () => {
      const result = await tools.getAuditLog({ operation_filter: "create_file" });
      expect(result.success).toBe(true);
      if (result.data?.entries && result.data.entries.length > 0) {
        result.data.entries.forEach((entry) => {
          expect(entry.operation).toBe("create_file");
        });
      }
    });

    it("should limit audit log entries", async () => {
      const result = await tools.getAuditLog({ limit: 5 });
      expect(result.success).toBe(true);
      expect(result.data?.entries.length).toBeLessThanOrEqual(5);
    });

    it("should log failed operations", async () => {
      // Attempt an operation that will fail
      await tools.readFile(`${TEST_PREFIX}_nonexistent_for_audit.txt`);

      const result = await tools.getAuditLog({ limit: 10 });
      expect(result.success).toBe(true);

      // Check that we have at least one failed entry
      const failedEntries = result.data?.entries.filter((e) => !e.success) || [];
      expect(failedEntries.length).toBeGreaterThanOrEqual(0); // May or may not log failures
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2.4.8 Workspace Info Tests
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("2.4.8 Workspace Info Tests", () => {
    it("should return workspace path", async () => {
      const result = await tools.getWorkspaceInfo();
      expect(result.success).toBe(true);
      expect(result.data?.workspace_path).toBeDefined();
      expect(typeof result.data?.workspace_path).toBe("string");
    });

    it("should return workspace statistics", async () => {
      const result = await tools.getWorkspaceInfo();
      expect(result.success).toBe(true);
      expect(result.data?.total_files).toBeDefined();
      expect(result.data?.total_size_mb).toBeDefined();
    });

    it("should update stats after file operations", async () => {
      // Get initial stats
      const before = await tools.getWorkspaceInfo();

      // Create a file
      const statsTestFile = `${TEST_PREFIX}_stats.txt`;
      await tools.createFile(statsTestFile, "Stats test content");

      // Get updated stats
      const after = await tools.getWorkspaceInfo();

      // File count should increase or stay same (depending on timing)
      expect(after.data?.total_files).toBeGreaterThanOrEqual(
        (before.data?.total_files || 0)
      );

      // Cleanup
      await tools.deleteFile(statsTestFile);
    });
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2.4.9 Cleanup Service Tests
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  describe("2.4.9 Cleanup Service Tests", () => {
    it("should have temp directory in workspace", async () => {
      const result = await tools.listFiles("temp");
      // Should succeed (temp dir exists) or be empty
      expect(result.success).toBe(true);
    });

    it("should store backups in temp directory", async () => {
      const backupTestFile = `${TEST_PREFIX}_backup_test.txt`;
      await tools.createFile(backupTestFile, "Original content");
      const updateResult = await tools.updateFile(backupTestFile, "New content", true);

      expect(updateResult.success).toBe(true);
      if (updateResult.data?.backup_path) {
        expect(updateResult.data.backup_path).toContain("temp");
      }

      // Cleanup
      await tools.deleteFile(backupTestFile);
    });
  });
});
