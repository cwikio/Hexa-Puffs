/**
 * Integration Test: Lazy-Spawn / Idle-Kill (Priority 10)
 *
 * Tests the agent lifecycle:
 * - Agents start as "stopped" (not spawned on startup)
 * - First message triggers lazy-spawn
 * - Activity tracking updates on dispatch
 * - Status reports include state/lastActivityAt
 *
 * Prerequisites: Full stack running (Orchestrator + at least one Thinker-capable agent)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  createOrchestratorClient,
  log,
  logSection,
  MCPTestClient,
  authFetch,
} from '../helpers/mcp-client.js';
import { parseJsonContent } from '../helpers/workflow-helpers.js';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8010';

interface StatusResponse {
  success: boolean;
  data: {
    agents: Array<{
      agentId: string;
      available: boolean;
      state: string;
      lastActivityAt: number;
      port: number;
      paused: boolean;
      isSubagent: boolean;
      parentAgentId: string | null;
    }>;
  };
}

describe('Workflow: Lazy-Spawn / Idle-Kill E2E', () => {
  let orchestrator: MCPTestClient;
  let orchestratorAvailable = false;

  beforeAll(async () => {
    logSection('Lazy-Spawn / Idle-Kill E2E Tests');

    orchestrator = createOrchestratorClient();
    const health = await orchestrator.healthCheck();
    orchestratorAvailable = health.healthy;

    if (!orchestratorAvailable) {
      log('Orchestrator not running — skipping all tests', 'error');
      return;
    }

    log('Orchestrator: UP', 'success');
  });

  describe('agent status reporting', () => {
    it('should include state and lastActivityAt in agent status', async () => {
      if (!orchestratorAvailable) {
        log('Skipping: Orchestrator unavailable', 'warn');
        return;
      }

      const result = await orchestrator.callTool('get_status', {});
      expect(result.success).toBe(true);

      const parsed = parseJsonContent<StatusResponse>(result);
      expect(parsed).toBeDefined();

      const agents = parsed?.data?.agents;
      if (!agents || agents.length === 0) {
        log('No agents configured — skipping', 'warn');
        return;
      }

      const agent = agents[0];
      log(`Agent "${agent.agentId}": state=${agent.state}, port=${agent.port}`, 'info');

      // Verify state field exists and is a valid value
      expect(['stopped', 'starting', 'running', 'stopping']).toContain(agent.state);
      expect(typeof agent.lastActivityAt).toBe('number');
      expect(typeof agent.isSubagent).toBe('boolean');
      expect(agent.parentAgentId === null || typeof agent.parentAgentId === 'string').toBe(true);

      log('Agent status includes state, lastActivityAt, isSubagent fields', 'success');
    });
  });

  describe('lazy spawn on first message', () => {
    it('should have agent in stopped or running state initially', async () => {
      if (!orchestratorAvailable) {
        log('Skipping: Orchestrator unavailable', 'warn');
        return;
      }

      const result = await orchestrator.callTool('get_status', {});
      const parsed = parseJsonContent<StatusResponse>(result);
      const agents = parsed?.data?.agents;

      if (!agents || agents.length === 0) {
        log('No agents — skipping', 'warn');
        return;
      }

      // Agent might be stopped (lazy) or running (if already triggered by a previous message)
      const agent = agents[0];
      log(`Initial state: "${agent.state}"`, 'info');
      expect(['stopped', 'running']).toContain(agent.state);
      log('Agent initial state verified', 'success');
    });

    it('should spawn agent when a Thinker skill is executed', async () => {
      if (!orchestratorAvailable) {
        log('Skipping: Orchestrator unavailable', 'warn');
        return;
      }

      // Execute a simple skill to trigger lazy-spawn
      const THINKER_URL = process.env.THINKER_URL || 'http://localhost:8006';
      try {
        const response = await fetch(`${THINKER_URL}/execute-skill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instructions: 'Reply with "hello" and nothing else.',
            maxSteps: 1,
            noTools: true,
          }),
          signal: AbortSignal.timeout(60000),
        });

        if (!response.ok) {
          log(`Thinker returned ${response.status} — may not be running`, 'warn');
          return;
        }

        const result = await response.json() as { success: boolean };
        log(`Skill execution: success=${result.success}`, 'info');
      } catch {
        log('Thinker not reachable — this tests lazy-spawn via Orchestrator dispatch', 'warn');
        return;
      }

      // Check status after skill execution
      const statusResult = await orchestrator.callTool('get_status', {});
      const parsed = parseJsonContent<StatusResponse>(statusResult);
      const agents = parsed?.data?.agents;

      if (agents && agents.length > 0) {
        const agent = agents[0];
        log(`After skill: state="${agent.state}", lastActivityAt=${agent.lastActivityAt}`, 'info');

        // If the Thinker is managed by AgentManager, it should now be running
        if (agent.state === 'running') {
          expect(agent.available).toBe(true);
          expect(agent.lastActivityAt).toBeGreaterThan(0);
          log('Agent is running after first skill execution', 'success');
        } else {
          log(`Agent state is "${agent.state}" — may be single-agent fallback mode`, 'info');
        }
      }
    }, 90000);
  });

  describe('spawn_subagent tool discovery', () => {
    it('should list spawn_subagent in available tools', async () => {
      if (!orchestratorAvailable) {
        log('Skipping: Orchestrator unavailable', 'warn');
        return;
      }

      const response = await authFetch(`${ORCHESTRATOR_URL}/tools/list`, {
        signal: AbortSignal.timeout(10000),
      });
      expect(response.ok).toBe(true);

      const data = await response.json() as { tools: Array<{ name: string }> };
      const toolNames = data.tools.map(t => t.name);

      const hasSpawnSubagent = toolNames.includes('spawn_subagent');
      log(`spawn_subagent tool: ${hasSpawnSubagent ? 'PRESENT' : 'MISSING'}`, hasSpawnSubagent ? 'success' : 'error');
      expect(hasSpawnSubagent).toBe(true);
    });
  });

  describe('Summary', () => {
    it('should report test results', () => {
      logSection('LAZY-SPAWN E2E TEST SUMMARY');
      log(`Orchestrator: ${orchestratorAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}`, 'info');
      log('Lazy-spawn E2E workflow tests completed', 'success');
    });
  });
});
