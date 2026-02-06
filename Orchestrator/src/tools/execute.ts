import { z } from 'zod';
import { getOrchestrator } from '../core/orchestrator.js';
import type { StandardResponse } from '../../../Shared/Types/StandardResponse.js';

export const executeToolDefinition = {
  name: 'execute_task',
  description: `Execute a task through the orchestrator. It will coordinate security scanning, use relevant tools (Telegram, 1Password), and return the result.

Examples:
- "Send 'Hello!' to Telegram"
- "Get my GitHub API key from 1Password"
- "Send the current time to Telegram"

Available tools depend on which MCP servers are running. Use get_status to check availability.`,
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
