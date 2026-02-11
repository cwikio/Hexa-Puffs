/**
 * Unit tests for contacts tool handlers.
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
  handleCreateContact,
  handleListContacts,
  handleUpdateContact,
} from '../../src/tools/contacts.js';

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
    CREATE INDEX IF NOT EXISTS idx_contacts_agent ON contacts(agent_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(agent_id, email);
  `);
});

beforeEach(() => {
  testDb.exec('DELETE FROM contacts');
});

describe('Contact Handlers', () => {
  describe('handleCreateContact', () => {
    it('should create a contact successfully', async () => {
      const result = await handleCreateContact({
        name: 'Alice Smith',
        email: 'alice@example.com',
        agent_id: 'test',
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('contact_id');
      expect(result.data).toHaveProperty('created_at');
    });

    it('should create a contact with all optional fields', async () => {
      const result = await handleCreateContact({
        name: 'Bob Jones',
        email: 'bob@corp.com',
        agent_id: 'test',
        company: 'BigCorp',
        role: 'CTO',
        type: 'work',
        notes: 'Prefers morning meetings',
      });

      expect(result.success).toBe(true);

      // Verify stored correctly
      const row = testDb.prepare('SELECT * FROM contacts WHERE id = ?').get(
        (result.data as { contact_id: number }).contact_id
      ) as Record<string, unknown>;

      expect(row.name).toBe('Bob Jones');
      expect(row.company).toBe('BigCorp');
      expect(row.role).toBe('CTO');
      expect(row.notes).toBe('Prefers morning meetings');
    });

    it('should reject duplicate emails within the same agent', async () => {
      await handleCreateContact({
        name: 'Alice',
        email: 'alice@example.com',
        agent_id: 'test',
      });

      const result = await handleCreateContact({
        name: 'Alice Duplicate',
        email: 'alice@example.com',
        agent_id: 'test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should allow same email for different agents', async () => {
      const r1 = await handleCreateContact({
        name: 'Alice A',
        email: 'alice@example.com',
        agent_id: 'agent-a',
      });

      const r2 = await handleCreateContact({
        name: 'Alice B',
        email: 'alice@example.com',
        agent_id: 'agent-b',
      });

      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
    });

    it('should reject missing name', async () => {
      const result = await handleCreateContact({
        email: 'test@example.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
    });

    it('should reject missing email', async () => {
      const result = await handleCreateContact({
        name: 'No Email',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
    });

    it('should default agent_id to main', async () => {
      const result = await handleCreateContact({
        name: 'Default Agent',
        email: 'default@example.com',
      });

      expect(result.success).toBe(true);

      const row = testDb.prepare('SELECT agent_id FROM contacts WHERE id = ?').get(
        (result.data as { contact_id: number }).contact_id
      ) as { agent_id: string };

      expect(row.agent_id).toBe('main');
    });

    it('should default type to work', async () => {
      const result = await handleCreateContact({
        name: 'Type Test',
        email: 'type@example.com',
      });

      expect(result.success).toBe(true);

      const row = testDb.prepare('SELECT type FROM contacts WHERE id = ?').get(
        (result.data as { contact_id: number }).contact_id
      ) as { type: string };

      expect(row.type).toBe('work');
    });
  });

  describe('handleListContacts', () => {
    beforeEach(async () => {
      await handleCreateContact({ name: 'Alice Smith', email: 'alice@bigcorp.com', agent_id: 'test', company: 'BigCorp', role: 'PM', type: 'work' });
      await handleCreateContact({ name: 'Bob Jones', email: 'bob@startup.io', agent_id: 'test', company: 'StartupCo', role: 'CTO', type: 'work' });
      await handleCreateContact({ name: 'Charlie Brown', email: 'charlie@personal.com', agent_id: 'test', type: 'personal' });
    });

    it('should list all contacts for an agent', async () => {
      const result = await handleListContacts({ agent_id: 'test' });

      expect(result.success).toBe(true);
      const data = result.data as { contacts: unknown[]; total_count: number };
      expect(data.contacts).toHaveLength(3);
      expect(data.total_count).toBe(3);
    });

    it('should filter by email', async () => {
      const result = await handleListContacts({ agent_id: 'test', email: 'alice@bigcorp.com' });

      expect(result.success).toBe(true);
      const data = result.data as { contacts: Array<{ name: string }> };
      expect(data.contacts).toHaveLength(1);
      expect(data.contacts[0].name).toBe('Alice Smith');
    });

    it('should filter by company', async () => {
      const result = await handleListContacts({ agent_id: 'test', company: 'BigCorp' });

      expect(result.success).toBe(true);
      const data = result.data as { contacts: Array<{ name: string }> };
      expect(data.contacts).toHaveLength(1);
      expect(data.contacts[0].name).toBe('Alice Smith');
    });

    it('should filter by type', async () => {
      const result = await handleListContacts({ agent_id: 'test', type: 'personal' });

      expect(result.success).toBe(true);
      const data = result.data as { contacts: Array<{ name: string }> };
      expect(data.contacts).toHaveLength(1);
      expect(data.contacts[0].name).toBe('Charlie Brown');
    });

    it('should filter by name (partial match)', async () => {
      const result = await handleListContacts({ agent_id: 'test', name: 'ali' });

      expect(result.success).toBe(true);
      const data = result.data as { contacts: Array<{ name: string }> };
      expect(data.contacts).toHaveLength(1);
      expect(data.contacts[0].name).toBe('Alice Smith');
    });

    it('should respect limit', async () => {
      const result = await handleListContacts({ agent_id: 'test', limit: 2 });

      expect(result.success).toBe(true);
      const data = result.data as { contacts: unknown[]; total_count: number };
      expect(data.contacts).toHaveLength(2);
      expect(data.total_count).toBe(3);
    });

    it('should return empty array for unknown agent', async () => {
      const result = await handleListContacts({ agent_id: 'nonexistent' });

      expect(result.success).toBe(true);
      const data = result.data as { contacts: unknown[]; total_count: number };
      expect(data.contacts).toHaveLength(0);
      expect(data.total_count).toBe(0);
    });

    it('should order by name ASC', async () => {
      const result = await handleListContacts({ agent_id: 'test' });

      expect(result.success).toBe(true);
      const data = result.data as { contacts: Array<{ name: string }> };
      const names = data.contacts.map(c => c.name);
      expect(names).toEqual(['Alice Smith', 'Bob Jones', 'Charlie Brown']);
    });
  });

  describe('handleUpdateContact', () => {
    let contactId: number;

    beforeEach(async () => {
      const result = await handleCreateContact({
        name: 'Update Me',
        email: 'update@example.com',
        agent_id: 'test',
        company: 'OldCorp',
      });
      contactId = (result.data as { contact_id: number }).contact_id;
    });

    it('should update a single field', async () => {
      const result = await handleUpdateContact({
        contact_id: contactId,
        company: 'NewCorp',
      });

      expect(result.success).toBe(true);
      const data = result.data as { updated_fields: string[] };
      expect(data.updated_fields).toContain('company');

      const row = testDb.prepare('SELECT company FROM contacts WHERE id = ?').get(contactId) as { company: string };
      expect(row.company).toBe('NewCorp');
    });

    it('should update multiple fields', async () => {
      const result = await handleUpdateContact({
        contact_id: contactId,
        name: 'Updated Name',
        role: 'VP',
        notes: 'New notes',
      });

      expect(result.success).toBe(true);
      const data = result.data as { updated_fields: string[] };
      expect(data.updated_fields).toContain('name');
      expect(data.updated_fields).toContain('role');
      expect(data.updated_fields).toContain('notes');
    });

    it('should set updated_at on update', async () => {
      // Manually backdate updated_at so we can verify the update changes it
      testDb.prepare("UPDATE contacts SET updated_at = datetime('now', '-1 hour') WHERE id = ?").run(contactId);
      const before = testDb.prepare('SELECT updated_at FROM contacts WHERE id = ?').get(contactId) as { updated_at: string };

      await handleUpdateContact({
        contact_id: contactId,
        notes: 'Triggers timestamp update',
      });

      const after = testDb.prepare('SELECT updated_at FROM contacts WHERE id = ?').get(contactId) as { updated_at: string };
      expect(after.updated_at).not.toBe(before.updated_at);
    });

    it('should return error for non-existent contact', async () => {
      const result = await handleUpdateContact({
        contact_id: 999999,
        name: 'Ghost',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error with no fields to update', async () => {
      const result = await handleUpdateContact({
        contact_id: contactId,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No fields');
    });
  });
});
