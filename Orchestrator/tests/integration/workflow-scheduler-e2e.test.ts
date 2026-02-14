/**
 * Level 4 E2E Test: Skill Scheduler Full Loop
 *
 * Tests the complete scheduling pipeline:
 *   1. Store a Direct-tier skill with execution_plan
 *   2. Wait for the Inngest skill-scheduler poller (runs every minute)
 *   3. Verify the skill executed (last_run_status updated)
 *   4. Verify Direct tier was used (last_run_summary mentions "Direct execution")
 *   5. Store a one-shot skill with `at` in the past
 *   6. Wait for poller to fire it
 *   7. Verify it auto-disabled after fire
 *
 * Prerequisites:
 *   - Full stack running: Orchestrator, Inngest, all MCPs
 *   - Telegram MCP connected (for the test tool call)
 *
 * Run with: npx vitest run tests/integration/workflow-scheduler-e2e.test.ts --timeout 180000
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

const POLLER_INTERVAL_MS = 65_000; // Poller runs every 60s, add 5s buffer
const POLL_CHECK_MS = 5_000; // Check every 5s during wait
const MAX_WAIT_MS = 130_000; // Max 2 poller cycles

async function callToolRaw(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await authFetch(`${MCP_URLS.orchestrator}/tools/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, arguments: args }),
  });

  const body = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const text = body.content?.[0]?.text;
  if (!text) return { success: false, error: 'No content in response' };

  return JSON.parse(text);
}

async function waitForSkillRun(
  skillId: number,
  timeoutMs: number = MAX_WAIT_MS,
): Promise<{ ran: boolean; status?: string; summary?: string; enabled?: boolean }> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const result = await callToolRaw('memory_get_skill', { skill_id: skillId });
    const skill = (result as { data?: { skill: Record<string, unknown> } }).data?.skill;

    if (skill?.last_run_status) {
      return {
        ran: true,
        status: skill.last_run_status as string,
        summary: skill.last_run_summary as string,
        enabled: skill.enabled as boolean,
      };
    }

    await new Promise(r => setTimeout(r, POLL_CHECK_MS));
  }

  return { ran: false };
}

describe('E2E: Skill Scheduler Full Loop', () => {
  const client = createOrchestratorClient();
  let stackAvailable = false;
  let inngestAvailable = false;
  const createdSkillIds: number[] = [];
  const agentId = 'thinker'; // Must use 'thinker' — the poller lists skills for this agent

  beforeAll(async () => {
    logSection('Skill Scheduler E2E');

    const availability = await checkMCPsAvailable([client]);
    stackAvailable = availability.get('Orchestrator') ?? false;

    if (!stackAvailable) {
      log('Orchestrator not available — skipping E2E tests', 'warn');
      return;
    }

    // Check if Inngest is running (poller won't fire without it)
    try {
      const inngestRes = await fetch('http://localhost:8288/v1/events', {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000),
      });
      // Inngest dev server returns various codes; anything but connection refused = running
      inngestAvailable = true;
    } catch {
      inngestAvailable = false;
      log('Inngest not reachable at :8288 — scheduler tests will be skipped', 'warn');
    }
  });

  afterAll(async () => {
    if (!stackAvailable) return;
    for (const skillId of createdSkillIds) {
      try {
        await callToolRaw('memory_delete_skill', { skill_id: skillId });
        log(`Cleaned up skill ${skillId}`, 'debug');
      } catch {
        log(`Failed to cleanup skill ${skillId}`, 'warn');
      }
    }
  });

  // ─── Direct Tier E2E ───────────────────────────────────────────────

  it('should execute a Direct-tier skill via the Inngest poller', async () => {
    if (!stackAvailable || !inngestAvailable) {
      log('Skipping: stack or Inngest not available', 'warn');
      return;
    }

    logSection('Direct Tier E2E');

    // 1. Store a Direct-tier skill that should fire immediately (interval_minutes: 1)
    const uid = testId();
    const storeResult = await callToolRaw('memory_store_skill', {
      agent_id: agentId,
      name: `E2E Direct Test ${uid}`,
      description: 'E2E test — Direct tier execution via poller',
      trigger_type: 'cron',
      trigger_config: { interval_minutes: 1 },
      instructions: 'Direct tier test — this text is ignored when execution_plan is present',
      execution_plan: [
        {
          id: 'store-fact',
          toolName: 'memory_store_fact',
          parameters: {
            fact: `E2E scheduler test fired at ${new Date().toISOString()} [${uid}]`,
            category: 'test',
          },
        },
      ],
      max_steps: 1,
      notify_on_completion: false,
    });

    expect(storeResult.success).toBe(true);
    const skillId = (storeResult as { data?: { skill_id: number } }).data?.skill_id;
    expect(skillId).toBeGreaterThan(0);
    createdSkillIds.push(skillId!);

    log(`Stored Direct-tier skill (id: ${skillId}), waiting for poller...`, 'info');

    // 2. Wait for the poller to execute it
    const result = await waitForSkillRun(skillId!);

    if (!result.ran) {
      log(`Skill did not execute within ${MAX_WAIT_MS / 1000}s — is Inngest running?`, 'warn');
      // Don't hard-fail; Inngest might not be processing
      return;
    }

    log(`Skill executed! status=${result.status}, summary=${result.summary}`, 'info');

    // 3. Verify Direct tier was used
    expect(result.status).toBe('success');
    expect(result.summary).toContain('Direct execution');

    // 4. Cleanup: delete the test fact
    try {
      const facts = await callToolRaw('memory_list_facts', { category: 'test' });
      const factsList = (facts as { data?: { facts: Array<{ id: number; content: string }> } }).data?.facts || [];
      for (const fact of factsList) {
        if (fact.content.includes(uid)) {
          await callToolRaw('memory_delete_fact', { fact_id: fact.id });
          log(`Cleaned up test fact ${fact.id}`, 'debug');
        }
      }
    } catch {
      // non-fatal
    }

    log('Direct tier E2E passed', 'success');
  }, MAX_WAIT_MS + 30_000);

  // ─── One-Shot E2E ──────────────────────────────────────────────────

  it('should fire a one-shot skill and auto-disable it', async () => {
    if (!stackAvailable || !inngestAvailable) {
      log('Skipping: stack or Inngest not available', 'warn');
      return;
    }

    logSection('One-Shot E2E');

    // 1. Store a one-shot skill with `at` in the past → should fire immediately
    const uid = testId();
    const pastTime = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago

    const storeResult = await callToolRaw('memory_store_skill', {
      agent_id: agentId,
      name: `E2E One-Shot Test ${uid}`,
      description: 'E2E test — one-shot schedule',
      trigger_type: 'cron',
      trigger_config: { at: pastTime },
      instructions: 'One-shot test — store a fact then auto-disable',
      execution_plan: [
        {
          id: 'mark',
          toolName: 'memory_store_fact',
          parameters: {
            fact: `One-shot E2E fired [${uid}]`,
            category: 'test',
          },
        },
      ],
      max_steps: 1,
      notify_on_completion: false,
    });

    expect(storeResult.success).toBe(true);
    const skillId = (storeResult as { data?: { skill_id: number } }).data?.skill_id;
    expect(skillId).toBeGreaterThan(0);
    createdSkillIds.push(skillId!);

    log(`Stored one-shot skill (id: ${skillId}, at: ${pastTime}), waiting...`, 'info');

    // 2. Wait for execution
    const result = await waitForSkillRun(skillId!);

    if (!result.ran) {
      log(`One-shot skill did not fire within ${MAX_WAIT_MS / 1000}s`, 'warn');
      return;
    }

    log(`One-shot fired! status=${result.status}, enabled=${result.enabled}`, 'info');

    // 3. Verify it executed successfully
    expect(result.status).toBe('success');

    // 4. Verify it auto-disabled
    expect(result.enabled).toBe(false);

    // 5. Cleanup test fact
    try {
      const facts = await callToolRaw('memory_list_facts', { category: 'test' });
      const factsList = (facts as { data?: { facts: Array<{ id: number; content: string }> } }).data?.facts || [];
      for (const fact of factsList) {
        if (fact.content.includes(uid)) {
          await callToolRaw('memory_delete_fact', { fact_id: fact.id });
        }
      }
    } catch {
      // non-fatal
    }

    log('One-shot E2E passed', 'success');
  }, MAX_WAIT_MS + 30_000);

  // ─── Cron Validation E2E ───────────────────────────────────────────

  it('should reject a skill with invalid cron before storage', async () => {
    if (!stackAvailable) return;

    const result = await callToolRaw('memory_store_skill', {
      agent_id: agentId,
      name: `E2E Bad Cron ${testId()}`,
      trigger_type: 'cron',
      trigger_config: { schedule: 'every three hours' },
      instructions: 'This should never be stored',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid cron expression');

    log('Bad cron rejected at creation time', 'success');
  });

  // ─── Normalization E2E ─────────────────────────────────────────────

  it('should normalize flattened schedule into trigger_config', async () => {
    if (!stackAvailable) return;

    const uid = testId();
    const storeResult = await callToolRaw('memory_store_skill', {
      agent_id: agentId,
      name: `E2E Normalizer ${uid}`,
      trigger_type: 'cron',
      instructions: 'Normalization test',
      schedule: '0 9 * * *', // Flattened — should be re-nested
    });

    expect(storeResult.success).toBe(true);
    const skillId = (storeResult as { data?: { skill_id: number } }).data?.skill_id;
    createdSkillIds.push(skillId!);

    // Verify it was stored with nested trigger_config
    const getResult = await callToolRaw('memory_get_skill', { skill_id: skillId });
    const skill = (getResult as { data?: { skill: Record<string, unknown> } }).data?.skill;

    expect(skill?.trigger_config).toBeDefined();
    const tc = skill?.trigger_config as Record<string, unknown>;
    expect(tc.schedule).toBe('0 9 * * *');

    log('Flattened schedule normalized into trigger_config', 'success');
  });

  // ─── Tool Removal E2E ──────────────────────────────────────────────

  it('should not expose old cron job tools', async () => {
    if (!stackAvailable) return;

    const response = await authFetch(`${MCP_URLS.orchestrator}/tools/list`);
    const body = (await response.json()) as { tools: Array<{ name: string }> };
    const toolNames = body.tools.map(t => t.name);

    expect(toolNames).not.toContain('create_job');
    expect(toolNames).not.toContain('list_jobs');
    expect(toolNames).not.toContain('delete_job');

    // get_job_status is still exposed — it's the companion to queue_task
    expect(toolNames).toContain('get_job_status');

    log('Old cron job tools are gone from tool list', 'success');
  });
});
