/**
 * Unit tests for projects tool handlers.
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
  handleCreateProject,
  handleListProjects,
  handleUpdateProject,
} from '../../src/tools/projects.js';

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
    CREATE INDEX IF NOT EXISTS idx_projects_agent ON projects(agent_id);
    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(agent_id, status);
  `);
});

beforeEach(() => {
  testDb.exec('DELETE FROM projects');
  testDb.exec('DELETE FROM contacts');
});

// Helper to insert a contact directly for FK tests
function insertContact(name: string, email: string, agentId = 'test'): number {
  const result = testDb.prepare(
    'INSERT INTO contacts (agent_id, name, email) VALUES (?, ?, ?)'
  ).run(agentId, name, email);
  return Number(result.lastInsertRowid);
}

describe('Project Handlers', () => {
  describe('handleCreateProject', () => {
    it('should create a project successfully', async () => {
      const result = await handleCreateProject({
        name: 'API Redesign',
        agent_id: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('project_id');
      expect(result.data).toHaveProperty('created_at');
    });

    it('should create a project with all optional fields', async () => {
      const contactId = insertContact('Alice', 'alice@example.com', 'test');

      const result = await handleCreateProject({
        name: 'Full Project',
        agent_id: 'test',
        status: 'active',
        type: 'work',
        description: 'A full-featured project',
        primary_contact_id: contactId,
        participants: [contactId],
        company: 'BigCorp',
        priority: 'high',
      });

      expect(result.success).toBe(true);

      const row = testDb.prepare('SELECT * FROM projects WHERE id = ?').get(
        (result.data as { project_id: number }).project_id
      ) as Record<string, unknown>;

      expect(row.name).toBe('Full Project');
      expect(row.description).toBe('A full-featured project');
      expect(row.primary_contact_id).toBe(contactId);
      expect(JSON.parse(row.participants as string)).toEqual([contactId]);
      expect(row.company).toBe('BigCorp');
      expect(row.priority).toBe('high');
    });

    it('should reject duplicate names within the same agent', async () => {
      await handleCreateProject({ name: 'Unique', agent_id: 'test' });

      const result = await handleCreateProject({ name: 'Unique', agent_id: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should allow same name for different agents', async () => {
      const r1 = await handleCreateProject({ name: 'Shared Name', agent_id: 'agent-a' });
      const r2 = await handleCreateProject({ name: 'Shared Name', agent_id: 'agent-b' });

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
    });

    it('should reject non-existent primary_contact_id', async () => {
      const result = await handleCreateProject({
        name: 'Bad Contact',
        agent_id: 'test',
        primary_contact_id: 999999,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should reject missing name', async () => {
      const result = await handleCreateProject({
        agent_id: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
    });

    it('should default status to active', async () => {
      const result = await handleCreateProject({ name: 'Default Status', agent_id: 'test' });

      expect(result.success).toBe(true);
      const row = testDb.prepare('SELECT status FROM projects WHERE id = ?').get(
        (result.data as { project_id: number }).project_id
      ) as { status: string };
      expect(row.status).toBe('active');
    });

    it('should default type to work', async () => {
      const result = await handleCreateProject({ name: 'Default Type', agent_id: 'test' });

      expect(result.success).toBe(true);
      const row = testDb.prepare('SELECT type FROM projects WHERE id = ?').get(
        (result.data as { project_id: number }).project_id
      ) as { type: string };
      expect(row.type).toBe('work');
    });

    it('should store participants as JSON', async () => {
      const result = await handleCreateProject({
        name: 'Participants Test',
        agent_id: 'test',
        participants: [1, 2, 3],
      });

      expect(result.success).toBe(true);
      const row = testDb.prepare('SELECT participants FROM projects WHERE id = ?').get(
        (result.data as { project_id: number }).project_id
      ) as { participants: string };
      expect(JSON.parse(row.participants)).toEqual([1, 2, 3]);
    });
  });

  describe('handleListProjects', () => {
    let contactId: number;

    beforeEach(async () => {
      contactId = insertContact('Alice', 'alice@example.com', 'test');

      await handleCreateProject({ name: 'Active Work', agent_id: 'test', status: 'active', type: 'work', company: 'BigCorp', priority: 'high', primary_contact_id: contactId });
      await handleCreateProject({ name: 'Paused Work', agent_id: 'test', status: 'paused', type: 'work', company: 'SmallCo' });
      await handleCreateProject({ name: 'Personal Project', agent_id: 'test', status: 'active', type: 'personal', priority: 'low', participants: [contactId] });
    });

    it('should list all projects for an agent', async () => {
      const result = await handleListProjects({ agent_id: 'test' });

      expect(result.success).toBe(true);
      const data = result.data as { projects: unknown[]; total_count: number };
      expect(data.projects).toHaveLength(3);
      expect(data.total_count).toBe(3);
    });

    it('should filter by status', async () => {
      const result = await handleListProjects({ agent_id: 'test', status: 'paused' });

      expect(result.success).toBe(true);
      const data = result.data as { projects: Array<{ name: string }> };
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].name).toBe('Paused Work');
    });

    it('should filter by type', async () => {
      const result = await handleListProjects({ agent_id: 'test', type: 'personal' });

      expect(result.success).toBe(true);
      const data = result.data as { projects: Array<{ name: string }> };
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].name).toBe('Personal Project');
    });

    it('should filter by company', async () => {
      const result = await handleListProjects({ agent_id: 'test', company: 'BigCorp' });

      expect(result.success).toBe(true);
      const data = result.data as { projects: Array<{ name: string }> };
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].name).toBe('Active Work');
    });

    it('should filter by priority', async () => {
      const result = await handleListProjects({ agent_id: 'test', priority: 'high' });

      expect(result.success).toBe(true);
      const data = result.data as { projects: Array<{ name: string }> };
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].name).toBe('Active Work');
    });

    it('should filter by contact_id (primary contact)', async () => {
      const result = await handleListProjects({ agent_id: 'test', contact_id: contactId });

      expect(result.success).toBe(true);
      const data = result.data as { projects: Array<{ name: string }> };
      // Should match both: Active Work (primary) and Personal Project (participant)
      expect(data.projects).toHaveLength(2);
      const names = data.projects.map(p => p.name).sort();
      expect(names).toEqual(['Active Work', 'Personal Project']);
    });

    it('should respect limit', async () => {
      const result = await handleListProjects({ agent_id: 'test', limit: 1 });

      expect(result.success).toBe(true);
      const data = result.data as { projects: unknown[]; total_count: number };
      expect(data.projects).toHaveLength(1);
      expect(data.total_count).toBe(3);
    });

    it('should return parsed participants as array', async () => {
      const result = await handleListProjects({ agent_id: 'test', type: 'personal' });

      expect(result.success).toBe(true);
      const data = result.data as { projects: Array<{ participants: number[] | null }> };
      expect(data.projects[0].participants).toEqual([contactId]);
    });

    it('should return empty array for unknown agent', async () => {
      const result = await handleListProjects({ agent_id: 'nonexistent' });

      expect(result.success).toBe(true);
      const data = result.data as { projects: unknown[]; total_count: number };
      expect(data.projects).toHaveLength(0);
      expect(data.total_count).toBe(0);
    });
  });

  describe('handleUpdateProject', () => {
    let projectId: number;

    beforeEach(async () => {
      const result = await handleCreateProject({
        name: 'Update Me',
        agent_id: 'test',
        status: 'active',
        company: 'OldCorp',
      });
      projectId = (result.data as { project_id: number }).project_id;
    });

    it('should update a single field', async () => {
      const result = await handleUpdateProject({
        project_id: projectId,
        status: 'paused',
      });

      expect(result.success).toBe(true);
      const data = result.data as { updated_fields: string[] };
      expect(data.updated_fields).toContain('status');

      const row = testDb.prepare('SELECT status FROM projects WHERE id = ?').get(projectId) as { status: string };
      expect(row.status).toBe('paused');
    });

    it('should update multiple fields', async () => {
      const result = await handleUpdateProject({
        project_id: projectId,
        name: 'Renamed',
        priority: 'high',
        description: 'New description',
      });

      expect(result.success).toBe(true);
      const data = result.data as { updated_fields: string[] };
      expect(data.updated_fields).toContain('name');
      expect(data.updated_fields).toContain('priority');
      expect(data.updated_fields).toContain('description');
    });

    it('should update participants as JSON', async () => {
      const result = await handleUpdateProject({
        project_id: projectId,
        participants: [10, 20],
      });

      expect(result.success).toBe(true);

      const row = testDb.prepare('SELECT participants FROM projects WHERE id = ?').get(projectId) as { participants: string };
      expect(JSON.parse(row.participants)).toEqual([10, 20]);
    });

    it('should clear priority with null', async () => {
      // First set a priority
      await handleUpdateProject({ project_id: projectId, priority: 'high' });

      // Then clear it
      const result = await handleUpdateProject({
        project_id: projectId,
        priority: null,
      });

      expect(result.success).toBe(true);
      const row = testDb.prepare('SELECT priority FROM projects WHERE id = ?').get(projectId) as { priority: string | null };
      expect(row.priority).toBeNull();
    });

    it('should set updated_at on update', async () => {
      // Manually backdate updated_at so we can verify the update changes it
      testDb.prepare("UPDATE projects SET updated_at = datetime('now', '-1 hour') WHERE id = ?").run(projectId);
      const before = testDb.prepare('SELECT updated_at FROM projects WHERE id = ?').get(projectId) as { updated_at: string };

      await handleUpdateProject({
        project_id: projectId,
        description: 'Triggers timestamp update',
      });

      const after = testDb.prepare('SELECT updated_at FROM projects WHERE id = ?').get(projectId) as { updated_at: string };
      expect(after.updated_at).not.toBe(before.updated_at);
    });

    it('should return error for non-existent project', async () => {
      const result = await handleUpdateProject({
        project_id: 999999,
        name: 'Ghost',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error with no fields to update', async () => {
      const result = await handleUpdateProject({
        project_id: projectId,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No fields');
    });
  });

  describe('Full CRUD Lifecycle', () => {
    it('should support create → list → update → list cycle', async () => {
      // Create
      const createResult = await handleCreateProject({
        name: 'Lifecycle Project',
        agent_id: 'test',
        status: 'active',
        priority: 'medium',
      });
      expect(createResult.success).toBe(true);
      const projectId = (createResult.data as { project_id: number }).project_id;

      // List
      let listResult = await handleListProjects({ agent_id: 'test' });
      expect(listResult.success).toBe(true);
      let projects = (listResult.data as { projects: Array<{ name: string; status: string }> }).projects;
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('Lifecycle Project');

      // Update
      const updateResult = await handleUpdateProject({
        project_id: projectId,
        status: 'completed',
        priority: 'high',
      });
      expect(updateResult.success).toBe(true);

      // List again to verify
      listResult = await handleListProjects({ agent_id: 'test', status: 'completed' });
      projects = (listResult.data as { projects: Array<{ name: string; status: string; priority: string }> }).projects;
      expect(projects).toHaveLength(1);
      expect(projects[0].status).toBe('completed');
      expect((projects[0] as { priority: string }).priority).toBe('high');
    });
  });
});
