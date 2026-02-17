/**
 * Level 2 Integration Tests: Projects Tools
 *
 * Tests create_project, list_projects, update_project
 *
 * Prerequisites:
 *   - Memorizer MCP must be running (npm run dev)
 *
 * Run with: npx vitest run tests/integration/projects.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpClient } from '../helpers/mcp-client.js';
import { dbHelper } from '../helpers/db-helpers.js';
import { generateTestAgentId } from '../helpers/test-data.js';

describe('Projects Tools', () => {
  let client: McpClient;
  let testAgentId: string;

  beforeEach(() => {
    client = new McpClient();
    testAgentId = generateTestAgentId('projects');
  });

  afterEach(() => {
    dbHelper.cleanupAgent(testAgentId);
  });

  // =========================================
  // SECTION 1: create_project
  // =========================================
  describe('create_project', () => {
    it('should create a project successfully', async () => {
      const result = await client.createProject('API Redesign', testAgentId);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      const data = result.data as { project_id: number };
      expect(data.project_id).toBeDefined();
      expect(typeof data.project_id).toBe('number');
    });

    it('should create a project with all fields', async () => {
      // First create a contact for FK
      const contactResult = await client.createContact('Alice', 'alice@corp.com', testAgentId);
      const contactId = (contactResult.data as { contact_id: number }).contact_id;

      const result = await client.createProject('Full Project', testAgentId, {
        status: 'active',
        type: 'work',
        description: 'Complete project',
        primary_contact_id: contactId,
        participants: [contactId],
        company: 'BigCorp',
        priority: 'high',
      });

      expect(result.success).toBe(true);
    });

    it('should reject duplicate names for same agent', async () => {
      await client.createProject('Unique', testAgentId);

      const result = await client.createProject('Unique', testAgentId);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject non-existent primary_contact_id', async () => {
      const result = await client.createProject('Bad FK', testAgentId, {
        primary_contact_id: 999999,
      });
      expect(result.success).toBe(false);
    });

    it('should require name', async () => {
      const result = await client.callTool('create_project', {
        agent_id: testAgentId,
      });
      expect(result.success).toBe(false);
    });
  });

  // =========================================
  // SECTION 2: list_projects
  // =========================================
  describe('list_projects', () => {
    let contactId: number;

    beforeEach(async () => {
      const contactResult = await client.createContact('Alice', 'alice@corp.com', testAgentId);
      contactId = (contactResult.data as { contact_id: number }).contact_id;

      await client.createProject('Active Work', testAgentId, {
        status: 'active', type: 'work', company: 'BigCorp', priority: 'high',
        primary_contact_id: contactId,
      });
      await client.createProject('Paused Work', testAgentId, {
        status: 'paused', type: 'work', company: 'SmallCo',
      });
      await client.createProject('Personal', testAgentId, {
        status: 'active', type: 'personal', priority: 'low',
        participants: [contactId],
      });
    });

    it('should list all projects for agent', async () => {
      const result = await client.listProjects(testAgentId);
      expect(result.success).toBe(true);

      const data = result.data as { projects: unknown[]; total_count: number };
      expect(data.projects.length).toBe(3);
      expect(data.total_count).toBe(3);
    });

    it('should filter by status', async () => {
      const result = await client.listProjects(testAgentId, { status: 'paused' });
      expect(result.success).toBe(true);

      const data = result.data as { projects: Array<{ name: string }> };
      expect(data.projects.length).toBe(1);
      expect(data.projects[0].name).toBe('Paused Work');
    });

    it('should filter by type', async () => {
      const result = await client.listProjects(testAgentId, { type: 'personal' });
      expect(result.success).toBe(true);

      const data = result.data as { projects: unknown[] };
      expect(data.projects.length).toBe(1);
    });

    it('should filter by company', async () => {
      const result = await client.listProjects(testAgentId, { company: 'BigCorp' });
      expect(result.success).toBe(true);

      const data = result.data as { projects: unknown[] };
      expect(data.projects.length).toBe(1);
    });

    it('should filter by priority', async () => {
      const result = await client.listProjects(testAgentId, { priority: 'high' });
      expect(result.success).toBe(true);

      const data = result.data as { projects: unknown[] };
      expect(data.projects.length).toBe(1);
    });

    it('should filter by contact_id (primary or participant)', async () => {
      const result = await client.listProjects(testAgentId, { contact_id: contactId });
      expect(result.success).toBe(true);

      const data = result.data as { projects: Array<{ name: string }> };
      // Should match Active Work (primary) and Personal (participant)
      expect(data.projects.length).toBe(2);
    });

    it('should return empty for unknown agent', async () => {
      const result = await client.listProjects('nonexistent-agent');
      expect(result.success).toBe(true);

      const data = result.data as { projects: unknown[] };
      expect(data.projects.length).toBe(0);
    });
  });

  // =========================================
  // SECTION 3: update_project
  // =========================================
  describe('update_project', () => {
    it('should update project fields', async () => {
      const createResult = await client.createProject('Update Me', testAgentId, {
        status: 'active',
        company: 'OldCorp',
      });
      const projectId = (createResult.data as { project_id: number }).project_id;

      const updateResult = await client.updateProject(projectId, {
        status: 'completed',
        priority: 'high',
      });
      expect(updateResult.success).toBe(true);

      const data = updateResult.data as { updated_fields: string[] };
      expect(data.updated_fields).toContain('status');
      expect(data.updated_fields).toContain('priority');
    });

    it('should return error for non-existent project', async () => {
      const result = await client.updateProject(999999, { status: 'paused' });
      expect(result.success).toBe(false);
    });
  });

  // =========================================
  // SECTION 4: Full CRUD lifecycle
  // =========================================
  describe('Full Lifecycle', () => {
    it('should support create contact → create project → update → verify cycle', async () => {
      // Create contact
      const contactResult = await client.createContact('Client A', 'client@corp.com', testAgentId);
      expect(contactResult.success).toBe(true);
      const contactId = (contactResult.data as { contact_id: number }).contact_id;

      // Create project linked to contact
      const createResult = await client.createProject('Client A Website', testAgentId, {
        primary_contact_id: contactId,
        company: 'ClientCorp',
        priority: 'medium',
        description: 'Build website for Client A',
      });
      expect(createResult.success).toBe(true);
      const projectId = (createResult.data as { project_id: number }).project_id;

      // List by contact
      const listResult = await client.listProjects(testAgentId, { contact_id: contactId });
      expect(listResult.success).toBe(true);
      const projects = (listResult.data as { projects: Array<{ name: string; description: string }> }).projects;
      expect(projects.length).toBe(1);
      expect(projects[0].name).toBe('Client A Website');

      // Update
      const updateResult = await client.updateProject(projectId, {
        status: 'completed',
        description: 'Website launched successfully',
      });
      expect(updateResult.success).toBe(true);

      // Verify
      const verifyResult = await client.listProjects(testAgentId, { status: 'completed' });
      const updated = (verifyResult.data as { projects: Array<{ description: string; status: string }> }).projects[0];
      expect(updated.status).toBe('completed');
      expect(updated.description).toBe('Website launched successfully');
    });
  });
});
