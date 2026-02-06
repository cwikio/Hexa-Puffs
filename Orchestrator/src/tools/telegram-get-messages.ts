import { z } from 'zod';
import { getOrchestrator } from '../core/orchestrator.js';
import type { StandardResponse } from '../../../Shared/Types/StandardResponse.js';

export const getMessagesToolDefinition = {
  name: 'get_telegram_messages',
  description: 'Get recent messages from a Telegram chat. Use this to read conversation history and see replies.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      chat_id: {
        type: 'string',
        description: 'Chat ID to get messages from (required). Use the numeric chat ID (e.g., "8304042211").',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of messages to retrieve (default: 10, max: 100)',
      },
    },
    required: ['chat_id'],
  },
};

const GetMessagesInputSchema = z.object({
  chat_id: z.string().min(1),
  limit: z.number().min(1).max(100).optional().default(10),
});

export async function handleGetMessages(args: unknown): Promise<StandardResponse> {
  const parseResult = GetMessagesInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { chat_id, limit } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.getTelegramMessages(chat_id, limit);

    return {
      success: result.success,
      data: result.messages,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
