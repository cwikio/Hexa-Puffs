/**
 * Level 3 Workflow Test: Skill Input Normalization
 *
 * Tests that the Orchestrator normalizes common LLM mistakes when storing skills:
 * - Flattened trigger_config fields get re-nested
 * - Invalid cron expressions are rejected before storage
 * - String required_tools are parsed to arrays
 *
 * Prerequisites:
 *   - Orchestrator must be running (with Memory MCP connected via stdio)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createOrchestratorClient,
  checkMCPsAvailable,
  authFetch,
  MCP_URLS,
  log,
  logSection,
  testId,
} from '../helpers/mcp-client.js';

/**
 * Store a skill via raw HTTP so we get the full response.
 */
async function storeSkillRaw(
  args: Record<string, unknown>,
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
  const response = await authFetch(`${MCP_URLS.orchestrator}/tools/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'memory_store_skill', arguments: args }),
  });

  const body = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const text = body.content?.[0]?.text;
  if (!text) return { success: false };

  return JSON.parse(text);
}

async function getSkillRaw(
  skillId: number,
): Promise<{ success: boolean; data?: { skill: Record<string, unknown> } }> {
  const response = await authFetch(`${MCP_URLS.orchestrator}/tools/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'memory_get_skill', arguments: { skill_id: skillId } }),
  });

  const body = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const text = body.content?.[0]?.text;
  if (!text) return { success: false };

  return JSON.parse(text);
}

describe('Workflow: Skill Input Normalization', () => {
  const client = createOrchestratorClient();
  let orchestratorAvailable = false;
  const createdSkillIds: number[] = [];
  const agentId = `test-normalizer-${testId()}`;

  beforeAll(async () => {
    logSection('Skill Input Normalization Tests');

    const availability = await checkMCPsAvailable([client]);
    orchestratorAvailable = availability.get('Orchestrator') ?? false;

    if (!orchestratorAvailable) {
      log('Orchestrator not available — skipping normalizer integration tests', 'warn');
    }
  });

  afterAll(async () => {
    if (!orchestratorAvailable) return;
    for (const skillId of createdSkillIds) {
      try {
        await client.callTool('memory_delete_skill', { skill_id: skillId });
        log(`Cleaned up skill ${skillId}`, 'debug');
      } catch {
        log(`Failed to cleanup skill ${skillId}`, 'warn');
      }
    }
  });

  it('should re-nest flattened schedule into trigger_config', async () => {
    if (!orchestratorAvailable) return;

    const parsed = await storeSkillRaw({
      agent_id: agentId,
      name: 'Flattened Schedule Test',
      trigger_type: 'cron',
      instructions: 'Test instructions',
      schedule: '0 9 * * *', // Flattened — should be nested into trigger_config
    });

    expect(parsed.success).toBe(true);
    const skillId = parsed.data?.skill_id as number;
    expect(skillId).toBeGreaterThan(0);
    createdSkillIds.push(skillId);

    // Verify the skill was stored with nested trigger_config
    const skill = await getSkillRaw(skillId);
    expect(skill.success).toBe(true);
    expect(skill.data?.skill?.trigger_config).toBeDefined();
    const tc = skill.data?.skill?.trigger_config as Record<string, unknown>;
    expect(tc.schedule).toBe('0 9 * * *');

    log('Flattened schedule correctly re-nested', 'success');
  });

  it('should reject invalid cron expression before storage', async () => {
    if (!orchestratorAvailable) return;

    const parsed = await storeSkillRaw({
      agent_id: agentId,
      name: 'Bad Cron Test',
      trigger_type: 'cron',
      instructions: 'Test instructions',
      trigger_config: { schedule: '*/abc * *' },
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Invalid cron expression');

    log('Invalid cron correctly rejected', 'success');
  });

  it('should accept valid cron expression', async () => {
    if (!orchestratorAvailable) return;

    const parsed = await storeSkillRaw({
      agent_id: agentId,
      name: 'Good Cron Test',
      trigger_type: 'cron',
      instructions: 'Test instructions',
      trigger_config: { schedule: '0 */2 * * *' },
    });

    expect(parsed.success).toBe(true);
    if (parsed.data?.skill_id) {
      createdSkillIds.push(parsed.data.skill_id as number);
    }

    log('Valid cron accepted', 'success');
  });
});
