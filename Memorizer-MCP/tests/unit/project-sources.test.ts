/**
 * Unit tests for project-sources tool handlers.
 * Uses an in-memory SQLite database — does NOT require a running server.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

// Create in-memory database with schema
let testDb: Database.Database;

vi.mock('../../src/db/index.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getDatabase: () => testDb,
    generateId: vi.fn(() => 'test-id'),
  };
});

vi.mock('../../src/config/index.js', () => ({
  getConfig: vi.fn(() => ({
    database: { path: ':memory:' },
    export: { path: '/tmp/export' },
    embedding: { provider: 'none', vectorWeight: 0.6, textWeight: 0.4 },
  })),
}));

vi.mock('../../src/embeddings/index.js', () => ({
  getEmbeddingProvider: vi.fn(() => null),
  isVectorSearchEnabled: vi.fn(() => false),
}));

vi.mock('../../src/embeddings/fact-embeddings.js', () => ({
  embedFact: vi.fn(),
  reembedFact: vi.fn(),
  deleteFactEmbedding: vi.fn(),
}));

vi.mock('@mcp/shared/Utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/services/fact-extractor.js', () => ({
  getFactExtractor: vi.fn(),
}));

vi.mock('../../src/services/sanitizer.js', () => ({
  isFactSafe: vi.fn(() => true),
}));

import {
  handleLinkProjectSource,
  handleUnlinkProjectSource,
  handleListProjectSources,
  handleUpdateProjectSourceStatus,
} from '../../src/tools/project-sources.js';

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');

  testDb.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL DEFAULT 'main',
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      company TEXT,
      role TEXT,
      type TEXT NOT NULL DEFAULT 'work',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL DEFAULT 'main',
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      type TEXT NOT NULL DEFAULT 'work',
      description TEXT,
      primary_contact_id INTEGER,
      participants TEXT,
      company TEXT,
      priority TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (primary_contact_id) REFERENCES contacts(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS project_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      mcp_name TEXT NOT NULL,
      external_project_id TEXT,
      external_project_name TEXT,
      source_type TEXT NOT NULL DEFAULT 'auto',
      last_status TEXT DEFAULT 'unknown',
      last_checked_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, mcp_name)
    );
    CREATE INDEX IF NOT EXISTS idx_project_sources_project ON project_sources(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_sources_mcp ON project_sources(mcp_name);
  `);
});

// Helper to insert a project directly
function insertProject(name: string, agentId = 'test'): number {
  const result = testDb.prepare(
    'INSERT INTO projects (agent_id, name) VALUES (?, ?)'
  ).run(agentId, name);
  return Number(result.lastInsertRowid);
}

beforeEach(() => {
  testDb.exec('DELETE FROM project_sources');
  testDb.exec('DELETE FROM projects');
});

describe('Project Source Handlers', () => {
  describe('handleLinkProjectSource', () => {
    it('should link a project to an MCP', async () => {
      const projectId = insertProject('Customer Lens');

      const result = await handleLinkProjectSource({
        project_id: projectId,
        mcp_name: 'vercel',
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('project_source_id');
      expect(result.data).toHaveProperty('linked_at');
    });

    it('should link with external details', async () => {
      const projectId = insertProject('Customer Lens');

      const result = await handleLinkProjectSource({
        project_id: projectId,
        mcp_name: 'vercel',
        external_project_id: 'prj_abc123',
        external_project_name: 'customer-lens-prod',
        source_type: 'manual',
      });

      expect(result.success).toBe(true);

      const row = testDb.prepare(
        'SELECT * FROM project_sources WHERE project_id = ? AND mcp_name = ?'
      ).get(projectId, 'vercel') as Record<string, unknown>;

      expect(row.external_project_id).toBe('prj_abc123');
      expect(row.external_project_name).toBe('customer-lens-prod');
      expect(row.source_type).toBe('manual');
    });

    it('should update existing link on duplicate (project_id, mcp_name)', async () => {
      const projectId = insertProject('Customer Lens');

      // First link
      await handleLinkProjectSource({
        project_id: projectId,
        mcp_name: 'vercel',
        external_project_name: 'old-name',
      });

      // Second link (same project_id + mcp_name)
      const result = await handleLinkProjectSource({
        project_id: projectId,
        mcp_name: 'vercel',
        external_project_name: 'new-name',
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('already_existed', true);

      const row = testDb.prepare(
        'SELECT external_project_name FROM project_sources WHERE project_id = ? AND mcp_name = ?'
      ).get(projectId, 'vercel') as { external_project_name: string };
      expect(row.external_project_name).toBe('new-name');
    });

    it('should reject non-existent project', async () => {
      const result = await handleLinkProjectSource({
        project_id: 999999,
        mcp_name: 'vercel',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should reject invalid input', async () => {
      const result = await handleLinkProjectSource({
        mcp_name: 'vercel',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
    });

    it('should default source_type to manual', async () => {
      const projectId = insertProject('Test');

      await handleLinkProjectSource({
        project_id: projectId,
        mcp_name: 'posthog',
      });

      const row = testDb.prepare(
        'SELECT source_type FROM project_sources WHERE project_id = ? AND mcp_name = ?'
      ).get(projectId, 'posthog') as { source_type: string };
      expect(row.source_type).toBe('manual');
    });
  });

  describe('handleUnlinkProjectSource', () => {
    it('should unlink a project from an MCP', async () => {
      const projectId = insertProject('Customer Lens');

      await handleLinkProjectSource({
        project_id: projectId,
        mcp_name: 'vercel',
      });

      const result = await handleUnlinkProjectSource({
        project_id: projectId,
        mcp_name: 'vercel',
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('unlinked_project', 'Customer Lens');
      expect(result.data).toHaveProperty('unlinked_mcp', 'vercel');

      // Verify it's gone
      const row = testDb.prepare(
        'SELECT id FROM project_sources WHERE project_id = ? AND mcp_name = ?'
      ).get(projectId, 'vercel');
      expect(row).toBeUndefined();
    });

    it('should return error for non-existent link', async () => {
      const result = await handleUnlinkProjectSource({
        project_id: 1,
        mcp_name: 'nonexistent',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No link found');
    });

    it('should reject invalid input', async () => {
      const result = await handleUnlinkProjectSource({});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
    });
  });

  describe('handleListProjectSources', () => {
    let projectAId: number;
    let projectBId: number;

    beforeEach(async () => {
      projectAId = insertProject('Customer Lens');
      projectBId = insertProject('Billing API');

      await handleLinkProjectSource({
        project_id: projectAId,
        mcp_name: 'vercel',
        external_project_name: 'customer-lens',
      });
      await handleLinkProjectSource({
        project_id: projectAId,
        mcp_name: 'posthog',
        external_project_name: 'Customer Lens',
      });
      await handleLinkProjectSource({
        project_id: projectBId,
        mcp_name: 'vercel',
        external_project_name: 'billing-api',
      });
    });

    it('should list all sources', async () => {
      const result = await handleListProjectSources({});

      expect(result.success).toBe(true);
      const data = result.data as { sources: unknown[]; total_count: number };
      expect(data.sources).toHaveLength(3);
      expect(data.total_count).toBe(3);
    });

    it('should filter by project_id', async () => {
      const result = await handleListProjectSources({
        project_id: projectAId,
      });

      expect(result.success).toBe(true);
      const data = result.data as { sources: Array<{ mcp_name: string }>; total_count: number };
      expect(data.sources).toHaveLength(2);
      const mcpNames = data.sources.map(s => s.mcp_name).sort();
      expect(mcpNames).toEqual(['posthog', 'vercel']);
    });

    it('should filter by mcp_name', async () => {
      const result = await handleListProjectSources({
        mcp_name: 'vercel',
      });

      expect(result.success).toBe(true);
      const data = result.data as { sources: Array<{ project_name: string }> };
      expect(data.sources).toHaveLength(2);
    });

    it('should filter by both project_id and mcp_name', async () => {
      const result = await handleListProjectSources({
        project_id: projectAId,
        mcp_name: 'vercel',
      });

      expect(result.success).toBe(true);
      const data = result.data as { sources: Array<{ external_project_name: string }> };
      expect(data.sources).toHaveLength(1);
      expect(data.sources[0].external_project_name).toBe('customer-lens');
    });

    it('should include project_name in results', async () => {
      const result = await handleListProjectSources({
        project_id: projectAId,
      });

      expect(result.success).toBe(true);
      const data = result.data as { sources: Array<{ project_name: string }> };
      expect(data.sources[0].project_name).toBe('Customer Lens');
    });

    it('should respect limit', async () => {
      const result = await handleListProjectSources({ limit: 1 });

      expect(result.success).toBe(true);
      const data = result.data as { sources: unknown[]; total_count: number };
      expect(data.sources).toHaveLength(1);
      expect(data.total_count).toBe(3);
    });

    it('should return empty for no matches', async () => {
      const result = await handleListProjectSources({ mcp_name: 'nonexistent' });

      expect(result.success).toBe(true);
      const data = result.data as { sources: unknown[]; total_count: number };
      expect(data.sources).toHaveLength(0);
      expect(data.total_count).toBe(0);
    });
  });

  describe('handleUpdateProjectSourceStatus', () => {
    it('should update status of a source', async () => {
      const projectId = insertProject('Customer Lens');
      const linkResult = await handleLinkProjectSource({
        project_id: projectId,
        mcp_name: 'vercel',
      });
      const sourceId = (linkResult.data as { project_source_id: number }).project_source_id;

      const result = await handleUpdateProjectSourceStatus({
        project_source_id: sourceId,
        last_status: 'ok',
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('updated_fields');

      const row = testDb.prepare('SELECT last_status, last_checked_at FROM project_sources WHERE id = ?')
        .get(sourceId) as { last_status: string; last_checked_at: string };
      expect(row.last_status).toBe('ok');
      expect(row.last_checked_at).toBeTruthy();
    });

    it('should accept custom last_checked_at', async () => {
      const projectId = insertProject('Test');
      const linkResult = await handleLinkProjectSource({
        project_id: projectId,
        mcp_name: 'vercel',
      });
      const sourceId = (linkResult.data as { project_source_id: number }).project_source_id;

      const timestamp = '2026-02-01T10:00:00.000Z';
      const result = await handleUpdateProjectSourceStatus({
        project_source_id: sourceId,
        last_status: 'warning',
        last_checked_at: timestamp,
      });

      expect(result.success).toBe(true);

      const row = testDb.prepare('SELECT last_checked_at FROM project_sources WHERE id = ?')
        .get(sourceId) as { last_checked_at: string };
      expect(row.last_checked_at).toBe(timestamp);
    });

    it('should reject non-existent source', async () => {
      const result = await handleUpdateProjectSourceStatus({
        project_source_id: 999999,
        last_status: 'ok',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should reject invalid status', async () => {
      const result = await handleUpdateProjectSourceStatus({
        project_source_id: 1,
        last_status: 'invalid_status',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
    });
  });

  describe('Cascade Delete', () => {
    it('should delete sources when project is deleted', async () => {
      const projectId = insertProject('Will Be Deleted');

      await handleLinkProjectSource({
        project_id: projectId,
        mcp_name: 'vercel',
      });
      await handleLinkProjectSource({
        project_id: projectId,
        mcp_name: 'posthog',
      });

      // Verify sources exist
      let sources = testDb.prepare(
        'SELECT COUNT(*) as count FROM project_sources WHERE project_id = ?'
      ).get(projectId) as { count: number };
      expect(sources.count).toBe(2);

      // Delete the project
      testDb.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

      // Verify cascade
      sources = testDb.prepare(
        'SELECT COUNT(*) as count FROM project_sources WHERE project_id = ?'
      ).get(projectId) as { count: number };
      expect(sources.count).toBe(0);
    });
  });
});
