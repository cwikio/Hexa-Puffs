import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  MCPTestClient,
  createOrchestratorClient,
  checkMCPsAvailable,
  authFetch,
  MCP_URLS,
  log,
  logSection,
  testId,
} from '../helpers/mcp-client.js';

/**
 * Helper: call memory_store_skill via raw HTTP to inspect the full response
 * (including the `warning` field which MCPTestClient.callTool() strips).
 */
async function storeSkillRaw(
  args: Record<string, unknown>,
): Promise<{ success: boolean; data?: Record<string, unknown>; warning?: string }> {
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

  return JSON.parse(text) as {
    success: boolean;
    data?: Record<string, unknown>;
    warning?: string;
  };
}

describe('Workflow: required_tools Validation at Proxy', () => {
  let client: MCPTestClient;
  let orchestratorAvailable = false;
  const createdSkillIds: number[] = [];
  const agentId = `test-validation-${testId()}`;

  beforeAll(async () => {
    client = createOrchestratorClient();
    logSection('required_tools Validation Tests');

    const availability = await checkMCPsAvailable([client]);
    orchestratorAvailable = availability.get('Orchestrator') ?? false;

    if (!orchestratorAvailable) {
      log('Orchestrator not available — tests will be skipped', 'warn');
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

  it('should store skill with valid required_tools without warning', async () => {
    if (!orchestratorAvailable) return;

    const parsed = await storeSkillRaw({
      agent_id: agentId,
      name: 'Valid Tools Test',
      trigger_type: 'manual',
      instructions: 'Test instructions',
      required_tools: ['memory_list_facts', 'memory_store_fact'],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.warning).toBeUndefined();
    expect(parsed.data?.skill_id).toBeDefined();

    createdSkillIds.push(parsed.data!.skill_id as number);
    log('Skill stored without warning', 'success');
  });

  it('should store skill with unknown required_tools and inject warning', async () => {
    if (!orchestratorAvailable) return;

    const parsed = await storeSkillRaw({
      agent_id: agentId,
      name: 'Unknown Tools Test',
      trigger_type: 'manual',
      instructions: 'Test instructions',
      required_tools: ['memory_list_facts', 'totally_fake_tool', 'invented_search'],
    });

    // Skill should still be stored
    expect(parsed.success).toBe(true);
    expect(parsed.data?.skill_id).toBeDefined();

    // Warning should be present with the unknown tool names
    expect(parsed.warning).toBeDefined();
    expect(parsed.warning).toContain('totally_fake_tool');
    expect(parsed.warning).toContain('invented_search');
    expect(parsed.warning).not.toContain('memory_list_facts');

    createdSkillIds.push(parsed.data!.skill_id as number);
    log(`Warning injected: ${parsed.warning}`, 'success');
  });

  it('should not inject warning when required_tools is absent', async () => {
    if (!orchestratorAvailable) return;

    const parsed = await storeSkillRaw({
      agent_id: agentId,
      name: 'No Tools Test',
      trigger_type: 'manual',
      instructions: 'Test instructions',
    });

    expect(parsed.success).toBe(true);
    expect(parsed.warning).toBeUndefined();

    if (parsed.data?.skill_id) {
      createdSkillIds.push(parsed.data.skill_id as number);
    }
    log('No warning when required_tools absent', 'success');
  });

  it('should not inject warning when all required_tools are custom handlers', async () => {
    if (!orchestratorAvailable) return;

    const parsed = await storeSkillRaw({
      agent_id: agentId,
      name: 'Custom Handlers Test',
      trigger_type: 'manual',
      instructions: 'Test instructions',
      required_tools: ['get_status', 'queue_task', 'get_tool_catalog'],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.warning).toBeUndefined();

    if (parsed.data?.skill_id) {
      createdSkillIds.push(parsed.data.skill_id as number);
    }
    log('No warning for custom handler tools', 'success');
  });
});
