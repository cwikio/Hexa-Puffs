import { z } from 'zod';
import { BaseMCPClient } from './base.js';
import { type MCPServerConfig } from '../config/index.js';

export interface SendMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface IncomingMessage {
  id: number;
  chatId: string;
  senderId?: string;
  senderName?: string;
  text: string;
  date: string;
  isOutgoing: boolean;
  receivedAt: string;
  hasMedia: boolean;
  mediaType?: string;
}

export interface NewMessagesResult {
  messages: IncomingMessage[];
  count: number;
  cleared?: boolean;
}

export interface SubscriptionResult {
  subscriptions: string[];
  count: number;
  mode: string;
}

const TelegramResponseSchema = z.object({
  message_id: z.number().optional(),
});

export class TelegramMCPClient extends BaseMCPClient {
  constructor(config: MCPServerConfig) {
    super('telegram', config);
  }

  async sendMessage(message: string, chatId?: string): Promise<SendMessageResult> {
    const args: Record<string, unknown> = { message };
    if (chatId) {
      args.chat_id = chatId;
    }

    const result = await this.callTool({
      name: 'send_message',
      arguments: args,
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error,
      };
    }

    const parsed = this.parseTextResponse(result);
    if (parsed === null) {
      // If we can't parse, assume success since the call succeeded
      return { success: true };
    }

    const validated = TelegramResponseSchema.safeParse(parsed);
    if (!validated.success) {
      // If validation fails but call succeeded, still return success
      this.logger.warn('Telegram response validation failed', { errors: validated.error.flatten() });
      return { success: true };
    }

    return {
      success: true,
      messageId: validated.data.message_id?.toString(),
    };
  }

  async getMessages(chatId: string, limit: number = 10): Promise<unknown> {
    const result = await this.callTool({
      name: 'get_messages',
      arguments: {
        chat_id: chatId,
        limit,
      },
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to get messages');
    }

    const parsed = this.parseTextResponse(result);
    return parsed;
  }

  async listChats(limit: number = 20): Promise<unknown> {
    const result = await this.callTool({
      name: 'list_chats',
      arguments: { limit },
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to list chats');
    }

    const parsed = this.parseTextResponse(result);
    return parsed;
  }

  async getNewMessages(peek: boolean = false): Promise<NewMessagesResult> {
    const result = await this.callTool({
      name: 'get_new_messages',
      arguments: { peek },
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to get new messages');
    }

    const parsed = this.parseTextResponse(result);
    return parsed as NewMessagesResult;
  }

  async subscribeChat(chatId: string): Promise<void> {
    const result = await this.callTool({
      name: 'subscribe_chat',
      arguments: { chat_id: chatId, action: 'subscribe' },
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to subscribe to chat');
    }
  }

  async unsubscribeChat(chatId: string): Promise<void> {
    const result = await this.callTool({
      name: 'subscribe_chat',
      arguments: { chat_id: chatId, action: 'unsubscribe' },
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to unsubscribe from chat');
    }
  }

  async listSubscriptions(): Promise<SubscriptionResult> {
    const result = await this.callTool({
      name: 'subscribe_chat',
      arguments: { action: 'list' },
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to list subscriptions');
    }

    const parsed = this.parseTextResponse(result);
    return parsed as SubscriptionResult;
  }

  async clearSubscriptions(): Promise<void> {
    const result = await this.callTool({
      name: 'subscribe_chat',
      arguments: { action: 'clear' },
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to clear subscriptions');
    }
  }
}
