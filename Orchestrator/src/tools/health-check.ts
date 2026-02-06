import { getOrchestrator } from '../core/orchestrator.js';
import type { StandardResponse } from '@mcp/shared/Types/StandardResponse.js';

export const healthCheckToolDefinition = {
  name: 'system_health_check',
  description:
    'Run health checks on all connected MCP servers. Returns per-MCP availability and health status, classified as internal or external.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      scope: {
        type: 'string' as const,
        enum: ['all', 'internal', 'external'],
        description:
          'Which MCPs to check: "all" (default), "internal" (auto-discovered), or "external" (from external-mcps.json).',
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

interface HealthCheckInput {
  scope?: 'all' | 'internal' | 'external';
}

export async function handleHealthCheck(args: unknown): Promise<StandardResponse> {
  try {
    const input = (args ?? {}) as HealthCheckInput;
    const scope = input.scope ?? 'all';

    const orchestrator = await getOrchestrator();
    const results = await orchestrator.checkMCPHealth(scope);

    const totalCount = results.length;
    const healthyCount = results.filter((r) => r.healthy).length;
    const unhealthyCount = totalCount - healthyCount;

    return {
      success: true,
      data: {
        scope,
        summary: {
          total: totalCount,
          healthy: healthyCount,
          unhealthy: unhealthyCount,
        },
        mcps: results,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
