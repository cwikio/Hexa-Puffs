import { getOrchestrator } from '../core/orchestrator.js';
import type { StandardResponse } from '@mcp/shared/Types/StandardResponse.js';

export const getToolCatalogToolDefinition = {
  name: 'get_tool_catalog',
  description:
    'List all available tools grouped by MCP server. Returns tool names and short descriptions (no full schemas). Use this to discover what tools exist before creating skills or automations.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [] as string[],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
};

export async function handleGetToolCatalog(): Promise<StandardResponse> {
  try {
    const orchestrator = await getOrchestrator();
    const toolRouter = orchestrator.getToolRouter();

    // Get all routes (exposedName → mcpName mapping)
    const routes = toolRouter.getAllRoutes();

    // Get all tool definitions (for descriptions)
    const definitions = toolRouter.getToolDefinitions();
    const descriptionMap = new Map<string, string>();
    for (const def of definitions) {
      // Take only the first sentence of the description to keep context compact
      const firstSentence = def.description.split(/\.\s/)[0];
      descriptionMap.set(def.name, firstSentence.endsWith('.') ? firstSentence : firstSentence + '.');
    }

    // Group by MCP name
    const catalog: Record<string, Array<{ name: string; description: string }>> = {};

    for (const route of routes) {
      const group = route.mcpName;
      if (!catalog[group]) {
        catalog[group] = [];
      }
      catalog[group].push({
        name: route.exposedName,
        description: descriptionMap.get(route.exposedName) ?? '(no description)',
      });
    }

    // Sort tools within each group alphabetically
    for (const group of Object.values(catalog)) {
      group.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Count totals
    const totalTools = routes.length;
    const totalMcps = Object.keys(catalog).length;

    return {
      success: true,
      data: {
        summary: `${totalTools} tools across ${totalMcps} MCP servers`,
        catalog,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
