import { z } from 'zod';
import { getOrchestrator } from '../core/orchestrator.js';
import type { StandardResponse } from '../../../Shared/Types/StandardResponse.js';

export const listChatsToolDefinition = {
  name: 'list_telegram_chats',
  description: 'List available Telegram chats/conversations. Use this to find chat IDs for sending messages.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of chats to return (default: 20, max: 50)',
      },
    },
    required: [],
  },
};

const ListChatsInputSchema = z.object({
  limit: z.number().min(1).max(50).optional().default(20),
});

export async function handleListChats(args: unknown): Promise<StandardResponse> {
  const parseResult = ListChatsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { limit } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.listTelegramChats(limit);

    return {
      success: result.success,
      data: result.chats,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
