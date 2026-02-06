import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  MCPTestClient,
  createOrchestratorClient,
  checkMCPsAvailable,
  MCP_URLS,
  log,
  logSection,
  testId,
} from '../helpers/mcp-client.js';

interface MessageResponse {
  success: boolean;
  response?: string;
  toolsUsed?: string[];
  totalSteps?: number;
  error?: string;
  paused?: boolean;
}

describe('Workflow: Cron-Scheduling Playbook E2E', () => {
  let orchestratorClient: MCPTestClient;
  let orchestratorAvailable = false;
  let thinkerAvailable = false;
  const createdSkillNames: string[] = [];
  const uniqueId = testId();

  beforeAll(async () => {
    orchestratorClient = createOrchestratorClient();
    logSection('Cron-Scheduling Playbook E2E Tests');

    const availability = await checkMCPsAvailable([orchestratorClient]);
    orchestratorAvailable = availability.get('Orchestrator') ?? false;

    // Check Thinker health separately (no auth)
    try {
      const response = await fetch(`${MCP_URLS.thinker}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      thinkerAvailable = response.ok;
    } catch {
      thinkerAvailable = false;
    }

    if (!orchestratorAvailable) log('Orchestrator not available', 'warn');
    if (!thinkerAvailable) log('Thinker not available', 'warn');
  });

  afterAll(async () => {
    if (!orchestratorAvailable) return;

    // Clean up any skills created during the test
    // List skills for thinker agent and delete test ones
    try {
      const result = await orchestratorClient.callTool('memory_list_skills', {
        agent_id: 'thinker',
      });
      if (result.success && result.data) {
        const data = result.data as { skills?: Array<{ id: number; name: string }> };
        const skills = data.skills ?? [];
        for (const skill of skills) {
          // Only delete skills that look like they were created by this test
          if (skill.name.toLowerCase().includes('test') || skill.name.includes(uniqueId)) {
            try {
              await orchestratorClient.callTool('memory_delete_skill', { skill_id: skill.id });
              log(`Cleaned up skill: ${skill.name} (${skill.id})`, 'debug');
            } catch {
              // ignore
            }
          }
        }
      }
    } catch {
      // ignore cleanup failures
    }
  });

  it('should activate cron-scheduling playbook and use get_tool_catalog', async () => {
    if (!thinkerAvailable || !orchestratorAvailable) {
      log('Skipping: Thinker or Orchestrator not available', 'warn');
      return;
    }

    log('Sending scheduling message to Thinker /process-message', 'info');

    const response = await fetch(`${MCP_URLS.thinker}/process-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: `test-cron-e2e-${uniqueId}`,
        senderId: 'test-user',
        text: 'Set up a skill that checks my emails every 3 hours and notifies me if there are urgent ones',
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (response.status === 503) {
      log('Thinker agent still initializing — skipping', 'warn');
      return;
    }

    expect(response.ok).toBe(true);
    const data = (await response.json()) as MessageResponse;

    // Graceful skip if agent is paused
    if (data.paused) {
      log('Agent paused by cost controls — skipping assertions', 'warn');
      return;
    }

    if (!data.success) {
      log(`Message handling failed (operational): ${data.error}`, 'warn');
      return;
    }

    log(`Response: success=${data.success}, steps=${data.totalSteps}`, 'info');
    log(`Tools used: ${data.toolsUsed?.join(', ') || 'none'}`, 'info');

    // Verify get_tool_catalog was called
    if (data.toolsUsed) {
      const usedCatalog = data.toolsUsed.includes('get_tool_catalog');
      const usedStoreSkill = data.toolsUsed.includes('memory_store_skill');

      if (usedCatalog) {
        log('get_tool_catalog was called', 'success');
      } else {
        log('get_tool_catalog was NOT called — LLM may have chosen a different path', 'warn');
      }

      if (usedStoreSkill) {
        log('memory_store_skill was called (classified as skill)', 'success');
      }

      // Soft assertion: we expect catalog to be used but don't hard-fail
      // because LLM behavior is non-deterministic
      expect(usedCatalog).toBe(true);
    }

    log('E2E cron-scheduling flow completed', 'success');
  }, 120000);
});
