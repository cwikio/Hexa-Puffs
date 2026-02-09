import { z } from 'zod';
import { getOrchestrator } from '../core/orchestrator.js';
import type { StandardResponse } from '@mcp/shared/Types/StandardResponse.js';

export const statusToolDefinition = {
  name: 'get_status',
  description: 'Get the current status of the orchestrator, including available MCP servers, session info, and system health.',
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

export async function handleStatus(): Promise<StandardResponse> {
  try {
    const orchestrator = await getOrchestrator();
    const status = orchestrator.getStatus();

    const uptimeSeconds = Math.floor(status.uptime / 1000);
    const uptimeMinutes = Math.floor(uptimeSeconds / 60);
    const uptimeHours = Math.floor(uptimeMinutes / 60);

    let uptimeStr: string;
    if (uptimeHours > 0) {
      uptimeStr = `${uptimeHours}h ${uptimeMinutes % 60}m`;
    } else if (uptimeMinutes > 0) {
      uptimeStr = `${uptimeMinutes}m ${uptimeSeconds % 60}s`;
    } else {
      uptimeStr = `${uptimeSeconds}s`;
    }

    const toolCount = orchestrator.getAvailableTools().length;

    return {
      success: true,
      data: {
        status: status.ready ? 'ready' : 'initializing',
        uptime: uptimeStr,
        mcp_servers: status.mcpServers,
        agents: status.agents.map((a) => ({
          agentId: a.agentId,
          available: a.available,
          state: a.state,
          port: a.port,
          restartCount: a.restartCount,
          paused: a.paused,
          pauseReason: a.pauseReason,
          lastActivityAt: a.lastActivityAt,
          isSubagent: a.isSubagent,
          parentAgentId: a.parentAgentId,
        })),
        tool_count: toolCount,
        sessions: status.sessions,
        security: status.security,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
