import { getOrchestrator } from '../core/orchestrator.js';
import type { StandardResponse } from '@mcp/shared/Types/StandardResponse.js';

export const getToolCatalogToolDefinition = {
  name: 'get_tool_catalog',
  description:
    'List available tools grouped by MCP server. ' +
    'Without mcp_name: returns a compact overview (MCP names + tool counts). ' +
    'With mcp_name: returns full tool names and descriptions for that MCP. ' +
    'Use without mcp_name first, then drill down into a specific MCP.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      mcp_name: {
        type: 'string',
        description: 'Filter to a specific MCP server name (e.g. "github", "vercel", "posthog"). Omit for all.',
      },
    },
    required: [] as string[],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
};

export async function handleGetToolCatalog(args: unknown): Promise<StandardResponse> {
  try {
    const orchestrator = await getOrchestrator();
    const toolRouter = orchestrator.getToolRouter();

    const { mcp_name: mcpFilter } = (args ?? {}) as { mcp_name?: string };

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
      if (mcpFilter && route.mcpName !== mcpFilter) continue;
      const group = route.mcpName;
      if (!catalog[group]) {
        catalog[group] = [];
      }
      catalog[group].push({
        name: route.exposedName,
        description: descriptionMap.get(route.exposedName) ?? '(no description)',
      });
    }

    // If filter was given but no group matched, return helpful error
    if (mcpFilter && Object.keys(catalog).length === 0) {
      const allMcpNames = [...new Set(routes.map((r) => r.mcpName))].sort();
      return {
        success: false,
        error: `No MCP server named "${mcpFilter}". Available: ${allMcpNames.join(', ')}`,
      };
    }

    // Sort tools within each group alphabetically
    for (const group of Object.values(catalog)) {
      group.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Count totals
    const totalTools = Object.values(catalog).reduce((sum, g) => sum + g.length, 0);
    const totalMcps = Object.keys(catalog).length;

    // Without mcp_name filter: return compact overview (just MCP names + counts)
    // With filter: return full tool details for that MCP
    if (mcpFilter) {
      return {
        success: true,
        data: {
          summary: `${totalTools} tools in ${mcpFilter}`,
          catalog,
        },
      };
    }

    const overview: Record<string, number> = {};
    for (const [name, tools] of Object.entries(catalog)) {
      overview[name] = tools.length;
    }
    return {
      success: true,
      data: {
        summary: `${totalTools} tools across ${totalMcps} MCP servers`,
        servers: overview,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
