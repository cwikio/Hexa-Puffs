import { describe, it, expect, beforeAll } from 'vitest';
import {
  MCPTestClient,
  createOrchestratorClient,
  checkMCPsAvailable,
  log,
  logSection,
} from '../helpers/mcp-client.js';
import { parseJsonContent } from '../helpers/workflow-helpers.js';

interface OverviewData {
  summary: string;
  servers: Record<string, number>;
}

interface DetailData {
  summary: string;
  catalog: Record<string, Array<{ name: string; description: string }>>;
}

type OverviewResponse = { success: boolean; data: OverviewData };
type DetailResponse = { success: boolean; data: DetailData };

describe('Tool Catalog (get_tool_catalog)', () => {
  let client: MCPTestClient;
  let orchestratorAvailable = false;

  beforeAll(async () => {
    client = createOrchestratorClient();
    logSection('Tool Catalog Integration Tests');

    const availability = await checkMCPsAvailable([client]);
    orchestratorAvailable = availability.get('Orchestrator') ?? false;

    if (!orchestratorAvailable) {
      log('Orchestrator not available — tests will be skipped', 'warn');
    }
  });

  it('should return a successful overview response', async () => {
    if (!orchestratorAvailable) return;

    const result = await client.callTool('get_tool_catalog', {});
    expect(result.success).toBe(true);

    const parsed = parseJsonContent<OverviewResponse>(result);
    expect(parsed?.success).toBe(true);
    expect(parsed?.data?.summary).toMatch(/\d+ tools across \d+ MCP servers/);
    expect(parsed?.data?.servers).toBeDefined();

    log(`Overview: ${parsed!.data.summary}`, 'success');
  });

  it('should include known MCP groups in overview', async () => {
    if (!orchestratorAvailable) return;

    const result = await client.callTool('get_tool_catalog', {});
    const parsed = parseJsonContent<OverviewResponse>(result);
    const servers = parsed!.data.servers;

    // These MCPs should be running in any standard setup
    expect(servers).toHaveProperty('memory');
    expect(servers).toHaveProperty('filer');

    log(`Found MCP groups: ${Object.keys(servers).join(', ')}`, 'success');
  });

  it('should return detailed catalog when mcp_name is specified', async () => {
    if (!orchestratorAvailable) return;

    const result = await client.callTool('get_tool_catalog', { mcp_name: 'memory' });
    expect(result.success).toBe(true);

    const parsed = parseJsonContent<DetailResponse>(result);
    expect(parsed?.success).toBe(true);
    expect(parsed?.data?.catalog).toBeDefined();
    expect(parsed?.data?.catalog?.memory).toBeDefined();

    const tools = parsed!.data.catalog.memory;
    let toolCount = 0;
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(3);
      toolCount++;
    }

    log(`Verified ${toolCount} memory tools all have descriptions`, 'success');
  });

  it('should return tools with correct prefixed naming', async () => {
    if (!orchestratorAvailable) return;

    const result = await client.callTool('get_tool_catalog', { mcp_name: 'memory' });
    const parsed = parseJsonContent<DetailResponse>(result);
    const catalog = parsed?.data?.catalog;

    if (catalog?.memory) {
      for (const tool of catalog.memory) {
        expect(tool.name).toMatch(/^memory_/);
      }
    }

    log('Tool naming convention verified', 'success');
  });
});
