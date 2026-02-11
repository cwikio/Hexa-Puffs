/**
 * Level 2 Integration Tests: Contacts Tools
 *
 * Tests create_contact, list_contacts, update_contact
 *
 * Prerequisites:
 *   - Memorizer MCP must be running (npm run dev)
 *
 * Run with: npx vitest run tests/integration/contacts.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpClient } from '../helpers/mcp-client.js';
import { dbHelper } from '../helpers/db-helpers.js';
import { generateTestAgentId } from '../helpers/test-data.js';

describe('Contacts Tools', () => {
  let client: McpClient;
  let testAgentId: string;

  beforeEach(() => {
    client = new McpClient();
    testAgentId = generateTestAgentId('contacts');
  });

  afterEach(() => {
    dbHelper.cleanupAgent(testAgentId);
  });

  // =========================================
  // SECTION 1: create_contact
  // =========================================
  describe('create_contact', () => {
    it('should create a contact successfully', async () => {
      const result = await client.createContact('Alice Smith', 'alice@example.com', testAgentId);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      const data = result.data as { contact_id: number };
      expect(data.contact_id).toBeDefined();
      expect(typeof data.contact_id).toBe('number');
    });

    it('should create a contact with all fields', async () => {
      const result = await client.createContact('Bob Jones', 'bob@corp.com', testAgentId, {
        company: 'BigCorp',
        role: 'CTO',
        type: 'work',
        notes: 'Prefers async communication',
      });

      expect(result.success).toBe(true);
    });

    it('should reject duplicate emails for same agent', async () => {
      const r1 = await client.createContact('Alice', 'same@example.com', testAgentId);
      expect(r1.success).toBe(true);

      const r2 = await client.createContact('Alice Dup', 'same@example.com', testAgentId);
      expect(r2.success).toBe(false);
      expect(r2.error).toBeDefined();
    });

    it('should require name and email', async () => {
      const result = await client.callTool('create_contact', {
        agent_id: testAgentId,
      });

      expect(result.success).toBe(false);
    });
  });

  // =========================================
  // SECTION 2: list_contacts
  // =========================================
  describe('list_contacts', () => {
    beforeEach(async () => {
      await client.createContact('Alice Smith', 'alice@bigcorp.com', testAgentId, { company: 'BigCorp', type: 'work' });
      await client.createContact('Bob Jones', 'bob@startup.io', testAgentId, { company: 'StartupCo', type: 'work' });
      await client.createContact('Charlie', 'charlie@gmail.com', testAgentId, { type: 'personal' });
    });

    it('should list all contacts for agent', async () => {
      const result = await client.listContacts(testAgentId);
      expect(result.success).toBe(true);

      const data = result.data as { contacts: unknown[]; total_count: number };
      expect(data.contacts.length).toBe(3);
      expect(data.total_count).toBe(3);
    });

    it('should filter by email', async () => {
      const result = await client.listContacts(testAgentId, { email: 'alice@bigcorp.com' });
      expect(result.success).toBe(true);

      const data = result.data as { contacts: Array<{ name: string }> };
      expect(data.contacts.length).toBe(1);
      expect(data.contacts[0].name).toBe('Alice Smith');
    });

    it('should filter by company', async () => {
      const result = await client.listContacts(testAgentId, { company: 'BigCorp' });
      expect(result.success).toBe(true);

      const data = result.data as { contacts: Array<{ name: string }> };
      expect(data.contacts.length).toBe(1);
    });

    it('should filter by type', async () => {
      const result = await client.listContacts(testAgentId, { type: 'personal' });
      expect(result.success).toBe(true);

      const data = result.data as { contacts: unknown[] };
      expect(data.contacts.length).toBe(1);
    });

    it('should filter by name (partial match)', async () => {
      const result = await client.listContacts(testAgentId, { name: 'ali' });
      expect(result.success).toBe(true);

      const data = result.data as { contacts: Array<{ name: string }> };
      expect(data.contacts.length).toBe(1);
      expect(data.contacts[0].name).toBe('Alice Smith');
    });

    it('should return empty for unknown agent', async () => {
      const result = await client.listContacts('nonexistent-agent');
      expect(result.success).toBe(true);

      const data = result.data as { contacts: unknown[] };
      expect(data.contacts.length).toBe(0);
    });
  });

  // =========================================
  // SECTION 3: update_contact
  // =========================================
  describe('update_contact', () => {
    it('should update contact fields', async () => {
      const createResult = await client.createContact('Update Me', 'update@test.com', testAgentId, {
        company: 'OldCorp',
      });
      const contactId = (createResult.data as { contact_id: number }).contact_id;

      const updateResult = await client.updateContact(contactId, {
        company: 'NewCorp',
        role: 'Director',
      });
      expect(updateResult.success).toBe(true);

      const data = updateResult.data as { updated_fields: string[] };
      expect(data.updated_fields).toContain('company');
      expect(data.updated_fields).toContain('role');
    });

    it('should return error for non-existent contact', async () => {
      const result = await client.updateContact(999999, { name: 'Ghost' });
      expect(result.success).toBe(false);
    });
  });

  // =========================================
  // SECTION 4: Full CRUD lifecycle
  // =========================================
  describe('Full Lifecycle', () => {
    it('should support complete create → list → update → verify cycle', async () => {
      // Create
      const createResult = await client.createContact('Lifecycle Contact', 'lifecycle@test.com', testAgentId, {
        company: 'TestCorp',
        role: 'Engineer',
      });
      expect(createResult.success).toBe(true);
      const contactId = (createResult.data as { contact_id: number }).contact_id;

      // List
      const listResult = await client.listContacts(testAgentId);
      expect(listResult.success).toBe(true);
      const contacts = (listResult.data as { contacts: Array<{ name: string }> }).contacts;
      expect(contacts.length).toBe(1);
      expect(contacts[0].name).toBe('Lifecycle Contact');

      // Update
      const updateResult = await client.updateContact(contactId, {
        role: 'Senior Engineer',
        notes: 'Promoted recently',
      });
      expect(updateResult.success).toBe(true);

      // Verify update via list
      const verifyResult = await client.listContacts(testAgentId);
      const updated = (verifyResult.data as { contacts: Array<{ role: string; notes: string }> }).contacts[0];
      expect(updated.role).toBe('Senior Engineer');
      expect(updated.notes).toBe('Promoted recently');
    });
  });
});
