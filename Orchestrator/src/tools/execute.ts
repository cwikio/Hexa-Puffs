import { z } from 'zod';
import { getOrchestrator } from '../core/orchestrator.js';
import type { StandardResponse } from '../../../Shared/Types/StandardResponse.js';

export const executeToolDefinition = {
  name: 'execute_task',
  description: `Execute a simple task via keyword matching (HTTP mode only). Supports basic Telegram sends and 1Password lookups. For precise control, call specific tools directly (e.g., send_message, get_item) instead of this. Use get_status to check which MCP servers are available.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      task: {
        type: 'string',
        description: 'The task to execute. Be specific about what you want done.',
      },
      context: {
        type: 'string',
        description: 'Optional additional context to help with task execution.',
      },
    },
    required: ['task'],
  },
};

const ExecuteInputSchema = z.object({
  task: z.string().min(1),
  context: z.string().optional(),
});

export async function handleExecute(args: unknown): Promise<StandardResponse> {
  const parseResult = ExecuteInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { task, context } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.execute(task, context);

    return {
      success: result.success,
      data: {
        result: result.result,
        tools_used: result.toolsUsed,
      },
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
