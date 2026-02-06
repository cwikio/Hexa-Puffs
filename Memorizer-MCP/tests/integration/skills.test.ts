/**
 * Level 2 Integration Tests: Skills Tools
 *
 * Tests store_skill, list_skills, get_skill, update_skill, delete_skill
 *
 * Prerequisites:
 *   - Memorizer MCP must be running (npm run dev)
 *
 * Run with: npm run test:skills
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { McpClient } from '../helpers/mcp-client.js';
import { dbHelper } from '../helpers/db-helpers.js';
import { generateTestAgentId } from '../helpers/test-data.js';

describe('Skills Tools', () => {
  let client: McpClient;
  let testAgentId: string;
  const createdSkillIds: number[] = [];

  beforeEach(() => {
    client = new McpClient();
    testAgentId = generateTestAgentId('skills');
  });

  afterEach(() => {
    dbHelper.cleanupAgent(testAgentId);
  });

  // =========================================
  // SECTION 1: store_skill
  // =========================================
  describe('store_skill', () => {
    it('should store a new skill successfully', async () => {
      const result = await client.storeSkill(
        'Test Email Organizer',
        'cron',
        'Organize emails into labels',
        testAgentId,
        {
          description: 'A test skill for organizing emails',
          trigger_config: { interval_minutes: 60 },
          required_tools: ['list_emails', 'create_label'],
          max_steps: 10,
        }
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      const data = result.data as { skill_id: number };
      expect(data.skill_id).toBeDefined();
      expect(typeof data.skill_id).toBe('number');

      createdSkillIds.push(data.skill_id);
    });

    it('should store a manual skill without trigger_config', async () => {
      const result = await client.storeSkill(
        'Manual Cleanup',
        'manual',
        'Clean up old draft emails',
        testAgentId
      );

      expect(result.success).toBe(true);
      const data = result.data as { skill_id: number };
      expect(data.skill_id).toBeDefined();
      createdSkillIds.push(data.skill_id);
    });

    it('should reject duplicate skill names for same agent', async () => {
      const result1 = await client.storeSkill(
        'Duplicate Test',
        'manual',
        'First skill',
        testAgentId
      );
      expect(result1.success).toBe(true);
      createdSkillIds.push((result1.data as { skill_id: number }).skill_id);

      const result2 = await client.storeSkill(
        'Duplicate Test',
        'cron',
        'Second skill same name',
        testAgentId
      );
      expect(result2.success).toBe(false);
      expect(result2.error).toBeDefined();
    });

    it('should reject invalid trigger_type', async () => {
      const result = await client.callTool('store_skill', {
        agent_id: testAgentId,
        name: 'Bad Trigger',
        trigger_type: 'invalid_type',
        instructions: 'Do something',
      });

      expect(result.success).toBe(false);
    });

    it('should require name and instructions', async () => {
      const result = await client.callTool('store_skill', {
        agent_id: testAgentId,
        trigger_type: 'manual',
      });

      expect(result.success).toBe(false);
    });
  });

  // =========================================
  // SECTION 2: list_skills
  // =========================================
  describe('list_skills', () => {
    it('should list all skills for agent', async () => {
      // Create a few skills
      const r1 = await client.storeSkill('Skill A', 'cron', 'Do A', testAgentId, {
        trigger_config: { interval_minutes: 60 },
      });
      const r2 = await client.storeSkill('Skill B', 'manual', 'Do B', testAgentId);
      const r3 = await client.storeSkill('Skill C', 'cron', 'Do C', testAgentId, {
        trigger_config: { interval_minutes: 120 },
      });

      createdSkillIds.push(
        (r1.data as { skill_id: number }).skill_id,
        (r2.data as { skill_id: number }).skill_id,
        (r3.data as { skill_id: number }).skill_id
      );

      const result = await client.listSkills(testAgentId);
      expect(result.success).toBe(true);

      const data = result.data as { skills: unknown[] };
      expect(data.skills).toBeDefined();
      expect(data.skills.length).toBe(3);
    });

    it('should filter skills by trigger_type', async () => {
      const r1 = await client.storeSkill('Cron Skill', 'cron', 'Do cron', testAgentId, {
        trigger_config: { interval_minutes: 60 },
      });
      const r2 = await client.storeSkill('Manual Skill', 'manual', 'Do manual', testAgentId);

      createdSkillIds.push(
        (r1.data as { skill_id: number }).skill_id,
        (r2.data as { skill_id: number }).skill_id
      );

      const result = await client.listSkills(testAgentId, { trigger_type: 'cron' });
      expect(result.success).toBe(true);

      const data = result.data as { skills: Array<{ trigger_type: string }> };
      expect(data.skills.length).toBe(1);
      expect(data.skills[0].trigger_type).toBe('cron');
    });

    it('should filter skills by enabled status', async () => {
      const r1 = await client.storeSkill('Enabled Skill', 'manual', 'Active', testAgentId);
      createdSkillIds.push((r1.data as { skill_id: number }).skill_id);

      const r2 = await client.storeSkill('Disabled Skill', 'manual', 'Inactive', testAgentId, {
        enabled: false,
      });
      createdSkillIds.push((r2.data as { skill_id: number }).skill_id);

      const enabledResult = await client.listSkills(testAgentId, { enabled: true });
      expect(enabledResult.success).toBe(true);
      const enabledData = enabledResult.data as { skills: unknown[] };
      expect(enabledData.skills.length).toBe(1);

      const disabledResult = await client.listSkills(testAgentId, { enabled: false });
      expect(disabledResult.success).toBe(true);
      const disabledData = disabledResult.data as { skills: unknown[] };
      expect(disabledData.skills.length).toBe(1);
    });

    it('should return empty array for agent with no skills', async () => {
      const result = await client.listSkills(testAgentId);
      expect(result.success).toBe(true);

      const data = result.data as { skills: unknown[] };
      expect(data.skills).toEqual([]);
    });
  });

  // =========================================
  // SECTION 3: get_skill
  // =========================================
  describe('get_skill', () => {
    it('should get a skill by ID with full details', async () => {
      const storeResult = await client.storeSkill(
        'Detail Test Skill',
        'cron',
        'Test getting full details',
        testAgentId,
        {
          description: 'Detailed test skill',
          trigger_config: { interval_minutes: 30 },
          required_tools: ['list_emails', 'get_email'],
          max_steps: 15,
          notify_on_completion: true,
        }
      );

      const skillId = (storeResult.data as { skill_id: number }).skill_id;
      createdSkillIds.push(skillId);

      const result = await client.getSkill(skillId);
      expect(result.success).toBe(true);

      const data = result.data as {
        skill: {
          id: number;
          name: string;
          agent_id: string;
          description: string;
          trigger_type: string;
          trigger_config: { interval_minutes: number };
          instructions: string;
          required_tools: string[];
          max_steps: number;
          enabled: boolean;
          notify_on_completion: boolean;
          last_run_at: string | null;
          last_run_status: string | null;
          last_run_summary: string | null;
          created_at: string;
          updated_at: string;
        };
      };

      expect(data.skill).toBeDefined();
      expect(data.skill.id).toBe(skillId);
      expect(data.skill.name).toBe('Detail Test Skill');
      expect(data.skill.agent_id).toBe(testAgentId);
      expect(data.skill.description).toBe('Detailed test skill');
      expect(data.skill.trigger_type).toBe('cron');
      expect(data.skill.trigger_config).toEqual({ interval_minutes: 30 });
      expect(data.skill.instructions).toBe('Test getting full details');
      expect(data.skill.required_tools).toEqual(['list_emails', 'get_email']);
      expect(data.skill.max_steps).toBe(15);
      expect(data.skill.enabled).toBe(true);
      expect(data.skill.notify_on_completion).toBe(true);
      expect(data.skill.last_run_at).toBeNull();
      expect(data.skill.last_run_status).toBeNull();
      expect(data.skill.created_at).toBeDefined();
    });

    it('should return error for non-existent skill', async () => {
      const result = await client.getSkill(999999);
      expect(result.success).toBe(false);
    });
  });

  // =========================================
  // SECTION 4: update_skill
  // =========================================
  describe('update_skill', () => {
    it('should update skill instructions', async () => {
      const storeResult = await client.storeSkill(
        'Update Test',
        'manual',
        'Original instructions',
        testAgentId
      );
      const skillId = (storeResult.data as { skill_id: number }).skill_id;
      createdSkillIds.push(skillId);

      const updateResult = await client.updateSkill(skillId, {
        instructions: 'Updated instructions with more detail',
      });
      expect(updateResult.success).toBe(true);

      const getResult = await client.getSkill(skillId);
      const skill = (getResult.data as { skill: { instructions: string } }).skill;
      expect(skill.instructions).toBe('Updated instructions with more detail');
    });

    it('should disable and re-enable a skill', async () => {
      const storeResult = await client.storeSkill(
        'Toggle Test',
        'cron',
        'Toggle me',
        testAgentId,
        { trigger_config: { interval_minutes: 60 } }
      );
      const skillId = (storeResult.data as { skill_id: number }).skill_id;
      createdSkillIds.push(skillId);

      // Disable
      await client.updateSkill(skillId, { enabled: false });
      let getResult = await client.getSkill(skillId);
      let skill = (getResult.data as { skill: { enabled: boolean } }).skill;
      expect(skill.enabled).toBe(false);

      // Re-enable
      await client.updateSkill(skillId, { enabled: true });
      getResult = await client.getSkill(skillId);
      skill = (getResult.data as { skill: { enabled: boolean } }).skill;
      expect(skill.enabled).toBe(true);
    });

    it('should update last_run fields', async () => {
      const storeResult = await client.storeSkill(
        'Run Tracking',
        'cron',
        'Track runs',
        testAgentId,
        { trigger_config: { interval_minutes: 60 } }
      );
      const skillId = (storeResult.data as { skill_id: number }).skill_id;
      createdSkillIds.push(skillId);

      const now = new Date().toISOString();
      await client.updateSkill(skillId, {
        last_run_at: now,
        last_run_status: 'success',
        last_run_summary: 'Organized 5 emails into 3 labels',
      });

      const getResult = await client.getSkill(skillId);
      const skill = (getResult.data as {
        skill: {
          last_run_at: string;
          last_run_status: string;
          last_run_summary: string;
        };
      }).skill;

      expect(skill.last_run_at).toBeDefined();
      expect(skill.last_run_status).toBe('success');
      expect(skill.last_run_summary).toBe('Organized 5 emails into 3 labels');
    });

    it('should return error for non-existent skill', async () => {
      const result = await client.updateSkill(999999, { enabled: false });
      expect(result.success).toBe(false);
    });
  });

  // =========================================
  // SECTION 5: delete_skill
  // =========================================
  describe('delete_skill', () => {
    it('should delete a skill by ID', async () => {
      const storeResult = await client.storeSkill(
        'Delete Me',
        'manual',
        'To be deleted',
        testAgentId
      );
      const skillId = (storeResult.data as { skill_id: number }).skill_id;

      const deleteResult = await client.deleteSkill(skillId);
      expect(deleteResult.success).toBe(true);

      // Verify it's gone
      const getResult = await client.getSkill(skillId);
      expect(getResult.success).toBe(false);
    });

    it('should return error for non-existent skill', async () => {
      const result = await client.deleteSkill(999999);
      expect(result.success).toBe(false);
    });
  });

  // =========================================
  // SECTION 6: Full CRUD lifecycle
  // =========================================
  describe('Full Lifecycle', () => {
    it('should support complete CRUD cycle', async () => {
      // Create
      const storeResult = await client.storeSkill(
        'Lifecycle Skill',
        'cron',
        'Analyze and organize',
        testAgentId,
        {
          description: 'Full lifecycle test',
          trigger_config: { interval_minutes: 1440 },
          required_tools: ['list_emails'],
          max_steps: 10,
        }
      );
      expect(storeResult.success).toBe(true);
      const skillId = (storeResult.data as { skill_id: number }).skill_id;

      // Read
      const getResult = await client.getSkill(skillId);
      expect(getResult.success).toBe(true);
      expect((getResult.data as { skill: { name: string } }).skill.name).toBe('Lifecycle Skill');

      // List
      const listResult = await client.listSkills(testAgentId);
      expect(listResult.success).toBe(true);
      expect((listResult.data as { skills: unknown[] }).skills.length).toBe(1);

      // Update
      const updateResult = await client.updateSkill(skillId, {
        name: 'Lifecycle Skill v2',
        max_steps: 20,
      });
      expect(updateResult.success).toBe(true);

      // Verify update
      const getResult2 = await client.getSkill(skillId);
      const updatedSkill = (getResult2.data as { skill: { name: string; max_steps: number } }).skill;
      expect(updatedSkill.name).toBe('Lifecycle Skill v2');
      expect(updatedSkill.max_steps).toBe(20);

      // Delete
      const deleteResult = await client.deleteSkill(skillId);
      expect(deleteResult.success).toBe(true);

      // Verify deleted
      const listResult2 = await client.listSkills(testAgentId);
      expect((listResult2.data as { skills: unknown[] }).skills.length).toBe(0);
    });
  });
});
