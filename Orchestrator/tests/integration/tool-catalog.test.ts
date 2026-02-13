import { describe, it, expect, beforeAll } from 'vitest';
import {
  MCPTestClient,
  createOrchestratorClient,
  checkMCPsAvailable,
  log,
  logSection,
} from '../helpers/mcp-client.js';
import { parseJsonContent } from '../helpers/workflow-helpers.js';

interface CatalogData {
  summary: string;
  catalog: Record<string, Array<{ name: string; description: string }>>;
}

type CatalogResponse = { success: boolean; data: CatalogData };

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

  it('should return a successful catalog response', async () => {
    if (!orchestratorAvailable) return;

    const result = await client.callTool('get_tool_catalog', {});
    expect(result.success).toBe(true);

    const parsed = parseJsonContent<CatalogResponse>(result);
    expect(parsed?.success).toBe(true);
    expect(parsed?.data?.summary).toMatch(/\d+ tools across \d+ MCP servers/);
    expect(parsed?.data?.catalog).toBeDefined();

    log(`Catalog: ${parsed!.data.summary}`, 'success');
  });

  it('should include known MCP groups', async () => {
    if (!orchestratorAvailable) return;

    const result = await client.callTool('get_tool_catalog', {});
    const parsed = parseJsonContent<CatalogResponse>(result);
    const catalog = parsed!.data.catalog;

    // These MCPs should be running in any standard setup
    expect(catalog).toHaveProperty('memory');
    expect(catalog).toHaveProperty('filer');

    log(`Found MCP groups: ${Object.keys(catalog).join(', ')}`, 'success');
  });

  it('should have non-empty descriptions for all tools', async () => {
    if (!orchestratorAvailable) return;

    const result = await client.callTool('get_tool_catalog', {});
    const parsed = parseJsonContent<CatalogResponse>(result);
    const catalog = parsed!.data.catalog;

    let toolCount = 0;
    for (const tools of Object.values(catalog)) {
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.description.length).toBeGreaterThan(3);
        toolCount++;
      }
    }

    log(`Verified ${toolCount} tools all have descriptions`, 'success');
  });

  it('should return tools with correct prefixed naming', async () => {
    if (!orchestratorAvailable) return;

    const result = await client.callTool('get_tool_catalog', {});
    const parsed = parseJsonContent<CatalogResponse>(result);
    const catalog = parsed!.data.catalog;

    // With alwaysPrefix: true, separator: '_', tools should be prefixed
    if (catalog.memory) {
      for (const tool of catalog.memory) {
        expect(tool.name).toMatch(/^memory_/);
      }
    }
    if (catalog.telegram) {
      for (const tool of catalog.telegram) {
        expect(tool.name).toMatch(/^telegram_/);
      }
    }

    log('Tool naming convention verified', 'success');
  });
});
