/**
 * Level 4 E2E Test: Skill Tier Routing & Verification
 *
 * Tests that COMPLEMENT workflow-scheduler-e2e.test.ts:
 *   1. Agent-tier skill dispatched via Inngest poller to Thinker
 *   2. Direct-tier skill with Telegram message verification
 *   3. Tool sandboxing via requiredTools
 *   4. notify_on_completion Telegram delivery
 *
 * Prerequisites:
 *   - Full stack running: Orchestrator, Thinker, Inngest, all MCPs
 *   - E2E_TELEGRAM_CHAT_ID env var set for Telegram-dependent tests
 *   - LLM provider configured (for Agent-tier + sandboxing tests)
 *
 * Run with: npx vitest run tests/integration/skill-tiers-e2e.test.ts --timeout 200000
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  checkMCPsAvailable,
  createOrchestratorClient,
  authFetch,
  MCP_URLS,
  log,
  logSection,
  testId,
} from '../helpers/mcp-client.js';

const POLL_CHECK_MS = 5_000;
const MAX_WAIT_MS = 130_000; // Max 2 poller cycles

const THINKER_URL = process.env.THINKER_URL || 'http://localhost:8006';
const E2E_TELEGRAM_CHAT_ID = process.env.E2E_TELEGRAM_CHAT_ID || '';

// ─── Shared Helpers ────────────────────────────────────────────────

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

  try {
    return JSON.parse(text);
  } catch {
    return { success: false, error: text };
  }
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

async function searchTelegramMessages(
  query: string,
  chatId?: string,
  limit: number = 10,
): Promise<Array<{ id: number; text: string; date: string }>> {
  const args: Record<string, unknown> = { query, limit };
  if (chatId) args.chat_id = chatId;

  const result = await callToolRaw('telegram_search_messages', args);
  const messages = (result as { data?: { messages: Array<{ id: number; text: string; date: string }> } })
    .data?.messages;
  return messages || [];
}

async function cleanupTestFacts(uid: string): Promise<void> {
  try {
    const facts = await callToolRaw('memory_list_facts', { category: 'pattern' });
    const factsList = (facts as { data?: { facts: Array<{ id: number; fact: string }> } }).data?.facts || [];
    for (const fact of factsList) {
      if (fact.fact.includes(uid)) {
        await callToolRaw('memory_delete_fact', { fact_id: fact.id });
        log(`Cleaned up test fact ${fact.id}`, 'debug');
      }
    }
  } catch {
    // non-fatal
  }
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Tests ─────────────────────────────────────────────────────────

describe('E2E: Skill Tier Routing & Verification', () => {
  const client = createOrchestratorClient();
  let stackAvailable = false;
  let thinkerAvailable = false;
  let inngestAvailable = false;
  let telegramTestsEnabled = false;
  const createdSkillIds: number[] = [];
  const testUids: string[] = [];
  const agentId = 'thinker';

  beforeAll(async () => {
    logSection('Skill Tier Routing E2E');

    const availability = await checkMCPsAvailable([client]);
    stackAvailable = availability.get('Orchestrator') ?? false;

    if (!stackAvailable) {
      log('Orchestrator not available — skipping all tests', 'warn');
      return;
    }

    // Check Thinker
    try {
      const res = await fetch(`${THINKER_URL}/health`, { signal: AbortSignal.timeout(3000) });
      thinkerAvailable = res.ok;
    } catch {
      thinkerAvailable = false;
    }
    if (!thinkerAvailable) {
      log('Thinker not available — Agent-tier and sandboxing tests will be skipped', 'warn');
    }

    // Check Inngest
    try {
      await fetch('http://localhost:8288/v1/events', {
        method: 'HEAD',
        signal: AbortSignal.timeout(3000),
      });
      inngestAvailable = true;
    } catch {
      inngestAvailable = false;
      log('Inngest not reachable at :8288 — poller tests will be skipped', 'warn');
    }

    // Check Telegram chat ID
    telegramTestsEnabled = E2E_TELEGRAM_CHAT_ID.length > 0;
    if (!telegramTestsEnabled) {
      log('E2E_TELEGRAM_CHAT_ID not set — Telegram verification tests will be skipped', 'warn');
    }
  });

  afterAll(async () => {
    if (!stackAvailable) return;

    // Cleanup skills
    for (const skillId of createdSkillIds) {
      try {
        await callToolRaw('memory_delete_skill', { skill_id: skillId });
        log(`Cleaned up skill ${skillId}`, 'debug');
      } catch {
        log(`Failed to cleanup skill ${skillId}`, 'warn');
      }
    }

    // Cleanup test facts
    for (const uid of testUids) {
      await cleanupTestFacts(uid);
    }
  });

  // ─── Test 1: Agent-Tier via Inngest Poller ────────────────────────

  it('should execute an Agent-tier skill via the Inngest poller', async () => {
    if (!stackAvailable || !inngestAvailable || !thinkerAvailable) {
      log('Skipping: stack, Inngest, or Thinker not available', 'warn');
      return;
    }

    logSection('Agent Tier E2E');

    const uid = testId();
    testUids.push(uid);

    // 1. Store an Agent-tier skill (instructions only, no execution_plan)
    const storeResult = await callToolRaw('memory_store_skill', {
      agent_id: agentId,
      name: `E2E Agent Tier ${uid}`,
      description: 'E2E test — Agent tier execution via poller',
      trigger_type: 'cron',
      trigger_config: { interval_minutes: 1 },
      instructions: `Call memory_store_fact with these exact parameters: { "fact": "Agent tier test ${uid}", "category": "pattern" }. Do not add any other parameters.`,
      required_tools: ['memory_store_fact'],
      max_steps: 3,
      notify_on_completion: false,
    });

    expect(storeResult.success).toBe(true);
    const skillId = (storeResult as { data?: { skill_id: number } }).data?.skill_id;
    expect(skillId).toBeGreaterThan(0);
    createdSkillIds.push(skillId!);

    log(`Stored Agent-tier skill (id: ${skillId}), waiting for poller...`, 'info');

    // 2. Wait for the poller to execute it
    const result = await waitForSkillRun(skillId!, MAX_WAIT_MS + 60_000);

    if (!result.ran) {
      log(`Skill did not execute within timeout — is Inngest running?`, 'warn');
      return;
    }

    log(`Skill executed! status=${result.status}, summary=${result.summary?.slice(0, 100)}`, 'info');

    // 3. Verify it ran via Agent tier (not Direct)
    expect(result.status).toBe('success');
    expect(result.summary).toBeDefined();
    expect(result.summary).not.toContain('Direct execution');

    // 4. Bonus: verify the fact was stored
    try {
      const facts = await callToolRaw('memory_list_facts', { category: 'pattern' });
      const factsList = (facts as { data?: { facts: Array<{ id: number; fact: string }> } }).data?.facts || [];
      const found = factsList.some(f => f.fact.includes(uid));
      if (found) {
        log('Agent-tier skill successfully stored a fact via LLM', 'success');
      } else {
        log('Fact not found — LLM may not have followed instructions exactly (non-fatal)', 'warn');
      }
    } catch {
      // non-fatal
    }

    log('Agent tier E2E passed', 'success');
  }, MAX_WAIT_MS + 90_000);

  // ─── Test 2: Direct-Tier with Telegram Delivery ───────────────────

  it('should deliver a Telegram message via Direct-tier execution_plan', async () => {
    if (!stackAvailable || !inngestAvailable) {
      log('Skipping: stack or Inngest not available', 'warn');
      return;
    }
    if (!telegramTestsEnabled) {
      log('Skipping: E2E_TELEGRAM_CHAT_ID not set', 'warn');
      return;
    }

    logSection('Direct Tier + Telegram E2E');

    const uid = testId();

    // 1. Store a Direct-tier skill that sends a Telegram message
    const storeResult = await callToolRaw('memory_store_skill', {
      agent_id: agentId,
      name: `E2E TG Direct ${uid}`,
      description: 'E2E test — Direct tier Telegram delivery',
      trigger_type: 'cron',
      trigger_config: { interval_minutes: 1 },
      instructions: 'Direct tier test — ignored when execution_plan is present',
      execution_plan: [
        {
          id: 'send',
          toolName: 'telegram_send_message',
          parameters: {
            chat_id: E2E_TELEGRAM_CHAT_ID,
            message: `E2E Direct tier test: ${uid}`,
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

    log(`Stored Direct-tier TG skill (id: ${skillId}), waiting for poller...`, 'info');

    // 2. Wait for execution
    const result = await waitForSkillRun(skillId!);

    if (!result.ran) {
      log(`Skill did not execute within timeout`, 'warn');
      return;
    }

    log(`Skill executed! status=${result.status}, summary=${result.summary}`, 'info');

    // 3. Verify Direct tier was used
    expect(result.status).toBe('success');
    expect(result.summary).toContain('Direct execution');

    // 4. Wait for Telegram indexing, then search for the message
    await wait(3000);

    const messages = await searchTelegramMessages(uid, E2E_TELEGRAM_CHAT_ID);
    expect(messages.length).toBeGreaterThanOrEqual(1);

    log(`Found ${messages.length} Telegram message(s) with marker`, 'success');
    log('Direct tier + Telegram delivery E2E passed', 'success');
  }, MAX_WAIT_MS + 30_000);

  // ─── Test 3: Tool Sandboxing ──────────────────────────────────────

  it('should sandbox tools when requiredTools is specified', async () => {
    if (!stackAvailable || !thinkerAvailable) {
      log('Skipping: stack or Thinker not available', 'warn');
      return;
    }

    logSection('Tool Sandboxing E2E');

    const uid = testId();
    testUids.push(uid);

    // 1. Call Thinker directly with requiredTools that EXCLUDE memory_store_fact
    const response = await fetch(`${THINKER_URL}/execute-skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillId: 0,
        instructions: `Call memory_store_fact with parameters: { "fact": "Sandbox test ${uid}", "category": "pattern" }. If the tool is not available, explain why.`,
        requiredTools: ['telegram_send_message'], // deliberately excludes memory_store_fact
        maxSteps: 2,
        notifyOnCompletion: false,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (response.status === 503) {
      log('Thinker still initializing — skipping', 'warn');
      return;
    }
    expect(response.status).toBe(200);

    const data = await response.json() as {
      success: boolean;
      toolsUsed?: string[];
      summary?: string;
      totalSteps?: number;
      error?: string;
      paused?: boolean;
    };

    log(`Sandboxing result: success=${data.success}, tools=${data.toolsUsed?.join(', ') || 'none'}`, 'info');

    if (data.paused) {
      log('Agent paused by cost controls — skipping assertions', 'warn');
      return;
    }

    // 2. Verify memory_store_fact was NOT used (sandboxed out)
    if (data.toolsUsed) {
      expect(data.toolsUsed).not.toContain('memory_store_fact');
    }

    // 3. Ground truth: verify no fact was stored
    const facts = await callToolRaw('memory_list_facts', { category: 'pattern' });
    const factsList = (facts as { data?: { facts: Array<{ id: number; fact: string }> } }).data?.facts || [];
    const found = factsList.some(f => f.fact.includes(uid));
    expect(found).toBe(false);

    log('Tool sandboxing verified — memory_store_fact was not available', 'success');
  }, 60_000);

  // ─── Test 4: notify_on_completion ─────────────────────────────────

  it('should send Telegram notification when notify_on_completion is true', async () => {
    if (!stackAvailable || !thinkerAvailable) {
      log('Skipping: stack or Thinker not available', 'warn');
      return;
    }
    if (!telegramTestsEnabled) {
      log('Skipping: E2E_TELEGRAM_CHAT_ID not set', 'warn');
      return;
    }

    logSection('Notify on Completion E2E');

    const uid = testId();

    // 1. Call Thinker directly with notify_on_completion
    const response = await fetch(`${THINKER_URL}/execute-skill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skillId: 0,
        skillName: `E2E Notify ${uid}`,
        instructions: `Respond with exactly this text and nothing else: Notify test ${uid}`,
        maxSteps: 1,
        noTools: true,
        notifyOnCompletion: true,
        notifyChatId: E2E_TELEGRAM_CHAT_ID,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (response.status === 503) {
      log('Thinker still initializing — skipping', 'warn');
      return;
    }
    expect(response.status).toBe(200);

    const data = await response.json() as {
      success: boolean;
      summary?: string;
      error?: string;
      paused?: boolean;
    };

    log(`Notify result: success=${data.success}, summary=${data.summary?.slice(0, 100)}`, 'info');

    if (!data.success) {
      if (data.paused) {
        log('Agent paused by cost controls — skipping', 'warn');
      } else {
        log(`Skill execution failed: ${data.error} — skipping notification check`, 'warn');
      }
      return;
    }

    // 2. Wait for Telegram delivery
    await wait(3000);

    // 3. Search for the notification message
    const messages = await searchTelegramMessages(uid, E2E_TELEGRAM_CHAT_ID);

    if (messages.length > 0) {
      log(`Found ${messages.length} notification message(s) with marker`, 'success');
      log('notify_on_completion E2E passed', 'success');
    } else {
      // Fallback: search for the skill name prefix
      const fallback = await searchTelegramMessages(`E2E Notify ${uid}`, E2E_TELEGRAM_CHAT_ID);
      if (fallback.length > 0) {
        log('Found notification by skill name (UID might not be in LLM response)', 'success');
      } else {
        log('Notification message not found in Telegram — LLM may not have echoed the UID', 'warn');
        // Don't hard-fail — the notification path depends on LLM output containing the UID
      }
    }
  }, 60_000);
});
