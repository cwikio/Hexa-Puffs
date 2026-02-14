/**
 * Level 3 Workflow Test: Direct Execution Tier
 *
 * Tests that skills with execution_plan are stored correctly and the
 * tier router would route them to direct execution (zero LLM).
 *
 * Prerequisites:
 *   - Orchestrator must be running (with Memory MCP connected via stdio)
 *
 * Note: Full execution of the direct tier (via Inngest poller) requires
 * the entire stack running. This test verifies the storage + retrieval path.
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

async function storeSkillRaw(
  args: Record<string, unknown>,
): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string; warning?: string }> {
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

describe('Workflow: Direct Execution Tier', () => {
  const client = createOrchestratorClient();
  let orchestratorAvailable = false;
  const createdSkillIds: number[] = [];
  const agentId = `test-direct-${testId()}`;

  beforeAll(async () => {
    logSection('Direct Execution Tier Tests');

    const availability = await checkMCPsAvailable([client]);
    orchestratorAvailable = availability.get('Orchestrator') ?? false;

    if (!orchestratorAvailable) {
      log('Orchestrator not available — skipping direct execution integration tests', 'warn');
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

  it('should store a skill with execution_plan', async () => {
    if (!orchestratorAvailable) return;

    const parsed = await storeSkillRaw({
      agent_id: agentId,
      name: 'Direct Greeting',
      trigger_type: 'cron',
      trigger_config: { schedule: '*/5 * * * *' },
      instructions: 'Send a greeting via Telegram (direct tier)',
      execution_plan: [
        { id: 'send', toolName: 'telegram_send_message', parameters: { message: 'Hello from direct tier!' } },
      ],
    });

    expect(parsed.success).toBe(true);
    const skillId = parsed.data?.skill_id as number;
    expect(skillId).toBeGreaterThan(0);
    createdSkillIds.push(skillId);

    log(`Stored skill with execution_plan (id: ${skillId})`, 'success');
  });

  it('should retrieve stored execution_plan', async () => {
    if (!orchestratorAvailable) return;
    if (createdSkillIds.length === 0) return;

    const skill = await getSkillRaw(createdSkillIds[0]);

    expect(skill.success).toBe(true);
    const plan = skill.data?.skill?.execution_plan;
    expect(Array.isArray(plan)).toBe(true);
    expect((plan as unknown[])[0]).toMatchObject({
      id: 'send',
      toolName: 'telegram_send_message',
    });

    log('execution_plan retrieved correctly', 'success');
  });

  it('should store a skill without execution_plan (agent tier)', async () => {
    if (!orchestratorAvailable) return;

    const parsed = await storeSkillRaw({
      agent_id: agentId,
      name: 'Agent Analysis',
      trigger_type: 'cron',
      trigger_config: { schedule: '0 8 * * *' },
      instructions: 'Analyze AI news and send summary via Telegram',
      required_tools: ['searcher_web_search', 'telegram_send_message'],
    });

    expect(parsed.success).toBe(true);
    const skillId = parsed.data?.skill_id as number;
    if (skillId) createdSkillIds.push(skillId);

    // Verify no execution_plan
    const skill = await getSkillRaw(skillId);
    expect(skill.data?.skill?.execution_plan).toBeNull();

    log('Agent-tier skill stored without execution_plan', 'success');
  });

  it('should verify cron job tools are no longer available', async () => {
    if (!orchestratorAvailable) return;

    const response = await authFetch(`${MCP_URLS.orchestrator}/tools/list`);
    const body = (await response.json()) as { tools: Array<{ name: string }> };
    const toolNames = body.tools.map(t => t.name);

    expect(toolNames).not.toContain('create_job');
    expect(toolNames).not.toContain('list_jobs');
    expect(toolNames).not.toContain('delete_job');

    // These should still exist
    expect(toolNames).toContain('queue_task');
    expect(toolNames).toContain('get_job_status');
    expect(toolNames).toContain('trigger_backfill');

    log('Old cron job tools correctly removed', 'success');
  });
});
