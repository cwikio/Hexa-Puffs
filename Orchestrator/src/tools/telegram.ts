import { z } from 'zod';
import { getOrchestrator } from '../core/orchestrator.js';
import type { StandardResponse } from '../../../Shared/Types/StandardResponse.js';

export const telegramToolDefinition = {
  name: 'send_telegram',
  description: 'Send a message via Telegram. The message will be security-scanned before sending. The chat_id parameter is required - use a numeric chat ID like "8304042211".',
  inputSchema: {
    type: 'object' as const,
    properties: {
      message: {
        type: 'string',
        description: 'The message to send',
      },
      chat_id: {
        type: 'string',
        description: 'Chat ID to send the message to (required). Use the numeric chat ID (e.g., "8304042211").',
      },
    },
    required: ['message', 'chat_id'],
  },
};

const TelegramInputSchema = z.object({
  message: z.string().min(1),
  chat_id: z.string().min(1),
});

export async function handleTelegram(args: unknown): Promise<StandardResponse> {
  const parseResult = TelegramInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { message, chat_id } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.sendTelegram(message, chat_id);

    return {
      success: result.success,
      data: {
        message: result.success ? 'Message sent successfully' : undefined,
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
