/**
 * spawn_subagent tool — allows an agent to spawn a temporary subagent
 * for parallel task execution. The tool blocks until the subagent completes.
 *
 * Subagents:
 * - Inherit parent's LLM config (with optional overrides)
 * - Get a subset of parent's tool permissions
 * - Cannot spawn their own subagents (single-level)
 * - Auto-kill after configurable timeout (default: 5 min)
 * - Max 5 concurrent per parent
 */

import { z } from 'zod';
import { logger } from '@mcp/shared/Utils/logger.js';
import { getOrchestrator } from '../core/orchestrator.js';
import type { StandardResponse } from '@mcp/shared/Types/StandardResponse.js';
import type { IncomingAgentMessage } from '../agents/agent-types.js';

const SpawnSubagentInputSchema = z.object({
  task: z.string().min(1).describe('Instructions for the subagent'),
  allowedTools: z.array(z.string()).optional().describe('Restrict tools (glob patterns)'),
  deniedTools: z.array(z.string()).optional().describe('Additional denied tools'),
  timeoutMinutes: z.number().min(1).max(30).optional().describe('Auto-kill timeout (default: 5)'),
  model: z.string().optional().describe('Override LLM model'),
});

export const spawnSubagentToolDefinition = {
  name: 'spawn_subagent',
  description:
    'Spawn a temporary subagent to handle a task independently. ' +
    'The subagent runs as a separate Thinker process with its own LLM context. ' +
    'This tool blocks until the subagent finishes and returns the result. ' +
    'Use for parallelizable subtasks. Max 5 concurrent subagents per parent. ' +
    'Subagents cannot spawn their own subagents.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      task: { type: 'string', description: 'Instructions for the subagent' },
      allowedTools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Restrict tools to these glob patterns (subset of parent\'s tools)',
      },
      deniedTools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Additional tools to deny (on top of parent\'s denied list)',
      },
      timeoutMinutes: {
        type: 'number',
        description: 'Auto-kill timeout in minutes (default: 5, max: 30)',
      },
      model: {
        type: 'string',
        description: 'Override LLM model (default: inherit from parent)',
      },
    },
    required: ['task'],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
};

/**
 * Handle spawn_subagent tool call.
 * Requires callerAgentId to identify the parent agent.
 */
export async function handleSpawnSubagent(
  args: unknown,
  callerAgentId?: string
): Promise<StandardResponse> {
  const log = logger.child('spawn-subagent');

  // Must be called by an identified agent
  if (!callerAgentId) {
    return {
      success: false,
      error: 'spawn_subagent can only be called by an identified agent (requires agentId in _meta)',
    };
  }

  // Validate input
  const parsed = SpawnSubagentInputSchema.safeParse(args);
  if (!parsed.success) {
    const errors = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    return { success: false, error: `Invalid input: ${errors}` };
  }

  const { task, allowedTools, deniedTools, timeoutMinutes, model } = parsed.data;
  const orchestrator = await getOrchestrator();
  const agentManager = orchestrator.getAgentManager();

  if (!agentManager) {
    return { success: false, error: 'AgentManager not available' };
  }

  let subagentId: string | undefined;

  try {
    // Spawn the subagent
    const { agentId: subId, client } = await agentManager.spawnSubagent({
      parentAgentId: callerAgentId,
      task,
      allowedTools,
      deniedTools,
      timeoutMinutes,
      model,
    });
    subagentId = subId;

    // Register subagent definition with Orchestrator for tool policy enforcement
    const subDef = agentManager.getAgentDefinition(subId);
    if (subDef) {
      orchestrator.registerAgentDefinition(subDef);
    }

    log.info(`Subagent "${subId}" spawned — dispatching task...`);

    // Dispatch the task to the subagent as a process-message call
    const message: IncomingAgentMessage = {
      id: `subagent-task-${Date.now()}`,
      chatId: `internal-${callerAgentId}`,
      senderId: callerAgentId,
      text: task,
      date: new Date().toISOString(),
      channel: 'internal',
      agentId: subId,
    };

    const result = await client.processMessage(message);

    log.info(
      `Subagent "${subId}" completed: success=${result.success}, steps=${result.totalSteps}, tools=${result.toolsUsed.join(', ') || 'none'}`
    );

    // Clean up the subagent after getting the result
    await agentManager.killSubagent(subId);
    orchestrator.unregisterAgentDefinition(subId);

    return {
      success: result.success,
      data: {
        response: result.response || result.error || 'No response',
        toolsUsed: result.toolsUsed,
        totalSteps: result.totalSteps,
        subagentId: subId,
      },
      error: result.success ? undefined : result.error,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log.error(`Subagent spawn/execution failed: ${msg}`);

    // Clean up on failure
    if (subagentId) {
      try {
        await agentManager.killSubagent(subagentId);
        orchestrator.unregisterAgentDefinition(subagentId);
      } catch {
        // Best-effort cleanup
      }
    }

    return { success: false, error: `Subagent failed: ${msg}` };
  }
}
