import { z } from 'zod';
import { TelegramMCPClient, NewMessagesResult, SubscriptionResult } from '../mcp-clients/telegram.js';
import { getConfig } from '../config/index.js';
import { logger } from '@mcp/shared/Utils/logger.js';

const getNewMessagesSchema = z.object({
  peek: z.boolean().optional().describe('If true, return without clearing queue'),
});

const subscribeChatSchema = z.object({
  chat_id: z.string().describe('Chat ID to subscribe to'),
});

const unsubscribeChatSchema = z.object({
  chat_id: z.string().describe('Chat ID to unsubscribe from'),
});

function getTelegramClient(): TelegramMCPClient {
  const config = getConfig();
  if (!config.mcpServers) {
    throw new Error('HTTP MCP servers not configured. Telegram realtime tools require HTTP mode.');
  }
  return new TelegramMCPClient(config.mcpServers.telegram);
}

export async function handleGetNewTelegramMessages(input: unknown): Promise<{
  success: boolean;
  messages?: NewMessagesResult['messages'];
  count?: number;
  error?: string;
}> {
  const result = getNewMessagesSchema.safeParse(input);
  if (!result.success) {
    return { success: false, error: result.error.message };
  }

  try {
    const client = getTelegramClient();
    const messages = await client.getNewMessages(result.data.peek);

    return {
      success: true,
      messages: messages.messages,
      count: messages.count,
    };
  } catch (error) {
    logger.error('Failed to get new Telegram messages', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleSubscribeTelegramChat(input: unknown): Promise<{
  success: boolean;
  subscribed?: string;
  error?: string;
}> {
  const result = subscribeChatSchema.safeParse(input);
  if (!result.success) {
    return { success: false, error: result.error.message };
  }

  try {
    const client = getTelegramClient();
    await client.subscribeChat(result.data.chat_id);

    return { success: true, subscribed: result.data.chat_id };
  } catch (error) {
    logger.error('Failed to subscribe to Telegram chat', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleUnsubscribeTelegramChat(input: unknown): Promise<{
  success: boolean;
  unsubscribed?: string;
  error?: string;
}> {
  const result = unsubscribeChatSchema.safeParse(input);
  if (!result.success) {
    return { success: false, error: result.error.message };
  }

  try {
    const client = getTelegramClient();
    await client.unsubscribeChat(result.data.chat_id);

    return { success: true, unsubscribed: result.data.chat_id };
  } catch (error) {
    logger.error('Failed to unsubscribe from Telegram chat', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleListTelegramSubscriptions(): Promise<{
  success: boolean;
  subscriptions?: string[];
  count?: number;
  mode?: string;
  error?: string;
}> {
  try {
    const client = getTelegramClient();
    const result = await client.listSubscriptions();

    return {
      success: true,
      subscriptions: result.subscriptions,
      count: result.count,
      mode: result.mode,
    };
  } catch (error) {
    logger.error('Failed to list Telegram subscriptions', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleClearTelegramSubscriptions(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const client = getTelegramClient();
    await client.clearSubscriptions();

    return { success: true };
  } catch (error) {
    logger.error('Failed to clear Telegram subscriptions', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export const getNewTelegramMessagesTool = {
  name: 'get_new_telegram_messages',
  description: 'Get new Telegram messages received in real-time since last check',
  inputSchema: {
    type: 'object' as const,
    properties: {
      peek: { type: 'boolean', description: 'If true, return without clearing queue' },
    },
    required: [] as string[],
  },
};

export const subscribeTelegramChatTool = {
  name: 'subscribe_telegram_chat',
  description: 'Subscribe to real-time messages from a specific Telegram chat',
  inputSchema: {
    type: 'object' as const,
    properties: {
      chat_id: { type: 'string', description: 'Chat ID to subscribe to' },
    },
    required: ['chat_id'] as string[],
  },
};

export const unsubscribeTelegramChatTool = {
  name: 'unsubscribe_telegram_chat',
  description: 'Unsubscribe from real-time messages from a specific Telegram chat',
  inputSchema: {
    type: 'object' as const,
    properties: {
      chat_id: { type: 'string', description: 'Chat ID to unsubscribe from' },
    },
    required: ['chat_id'] as string[],
  },
};

export const listTelegramSubscriptionsTool = {
  name: 'list_telegram_subscriptions',
  description: 'List all Telegram chat subscriptions for real-time messages',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [] as string[],
  },
};

export const clearTelegramSubscriptionsTool = {
  name: 'clear_telegram_subscriptions',
  description: 'Clear all Telegram chat subscriptions (receive messages from all chats)',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [] as string[],
  },
};
