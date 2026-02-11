/**
 * GenericChannelAdapter — convention-based adapter that works for any channel MCP.
 *
 * Derives tool names from the MCP name (e.g., "telegram" → "telegram_send_message").
 * All channel-specific behavior (bot-pattern filtering, chat refresh, recency)
 * is driven by ChannelAdapterConfig — no subclasses needed.
 */

import { logger, type Logger } from '@mcp/shared/Utils/logger.js';
import type { ToolRouter } from '../../routing/tool-router.js';
import type { IncomingAgentMessage } from '../../agents/agent-types.js';
import type { ChannelAdapter, ChannelAdapterConfig } from '../channel-adapter.js';

/** Shape of a message returned by a channel MCP's get_messages tool. */
interface ChannelMessage {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  date: string;
  isOutgoing?: boolean;
}

/** Shape of a chat returned by a channel MCP's list_chats tool. */
interface ChannelChat {
  id: string;
  type: string;
  title: string;
  unreadCount?: number;
}

const DEFAULT_BOT_PATTERNS = [
  'I encountered an error:',
  'I apologize, but I was unable to',
  'Failed after',
  'rate limit issue cannot be resolved',
  'Invalid API Key',
  'I was unable to generate a response',
  "Sorry, I couldn't complete that request",
];

const DEFAULT_CHAT_REFRESH_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_MESSAGE_AGE_MS = 2 * 60 * 1000; // 2 minutes
const PROCESSED_IDS_HIGH_WATER = 1000;
const PROCESSED_IDS_LOW_WATER = 500;

export class GenericChannelAdapter implements ChannelAdapter {
  readonly channel: string;

  private toolRouter: ToolRouter;
  private log: Logger;

  // Config (with defaults)
  private botPatterns: string[];
  private chatRefreshIntervalMs: number;
  private maxMessageAgeMs: number;

  // Tool names (derived from channel)
  private tools: {
    sendMessage: string;
    getMessages: string;
    getMe: string;
    listChats: string;
    subscribeChat: string;
  };

  // Capabilities (probed at initialize)
  private hasGetMe = false;
  private hasListChats = false;
  private hasSubscribeChat = false;

  // Polling state
  private botUserId: string | null = null;
  private monitoredChatIds: string[] = [];
  private lastChatRefresh = 0;
  private processedMessageIds: Set<string> = new Set();

  constructor(mcpName: string, toolRouter: ToolRouter, config?: ChannelAdapterConfig) {
    this.channel = mcpName;
    this.toolRouter = toolRouter;
    this.log = logger.child(`channel:${mcpName}`);

    this.botPatterns = config?.botPatterns ?? DEFAULT_BOT_PATTERNS;
    this.chatRefreshIntervalMs = config?.chatRefreshIntervalMs ?? DEFAULT_CHAT_REFRESH_MS;
    this.maxMessageAgeMs = config?.maxMessageAgeMs ?? DEFAULT_MAX_MESSAGE_AGE_MS;

    // Derive tool names from MCP name using ToolRouter's naming convention
    // (alwaysPrefix: true, separator: '_')
    this.tools = {
      sendMessage: `${mcpName}_send_message`,
      getMessages: `${mcpName}_get_messages`,
      getMe: `${mcpName}_get_me`,
      listChats: `${mcpName}_list_chats`,
      subscribeChat: `${mcpName}_subscribe_chat`,
    };
  }

  async initialize(): Promise<void> {
    // Probe optional tool availability
    this.hasGetMe = this.toolRouter.hasRoute(this.tools.getMe);
    this.hasListChats = this.toolRouter.hasRoute(this.tools.listChats);
    this.hasSubscribeChat = this.toolRouter.hasRoute(this.tools.subscribeChat);

    this.log.info(`Capabilities: get_me=${this.hasGetMe}, list_chats=${this.hasListChats}, subscribe_chat=${this.hasSubscribeChat}`);

    // Fetch bot identity for self-message filtering
    if (this.hasGetMe) {
      try {
        const result = await this.toolRouter.routeToolCall(this.tools.getMe, {});
        if (result.success) {
          const data = this.extractData<{ user: { id: string } }>(result);
          if (data?.user?.id) {
            this.botUserId = data.user.id;
            this.log.info(`Bot user ID: ${this.botUserId}`);
          }
        }
      } catch {
        this.log.warn('Could not fetch bot identity — self-message filtering disabled');
      }
    }

    // Initial chat discovery
    await this.refreshMonitoredChats();
  }

  async poll(): Promise<IncomingAgentMessage[]> {
    // Refresh monitored chats periodically
    if (
      (this.hasSubscribeChat || this.hasListChats) &&
      (this.monitoredChatIds.length === 0 || Date.now() - this.lastChatRefresh > this.chatRefreshIntervalMs)
    ) {
      await this.refreshMonitoredChats();
      this.lastChatRefresh = Date.now();
    }

    const messages: IncomingAgentMessage[] = [];

    if (this.monitoredChatIds.length > 0) {
      // Chat-based polling: fetch messages per monitored chat
      for (const chatId of this.monitoredChatIds) {
        const chatMessages = await this.fetchMessages(chatId, 5);
        const filtered = this.filterMessages(chatMessages);
        messages.push(...filtered);
      }
    } else {
      // No chat discovery — call get_messages without chat_id
      const allMessages = await this.fetchMessages(undefined, 10);
      const filtered = this.filterMessages(allMessages);
      messages.push(...filtered);
    }

    // Sort oldest first
    messages.sort((a, b) => {
      const numA = parseInt(a.id, 10);
      const numB = parseInt(b.id, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.id.localeCompare(b.id);
    });

    // Cleanup old processed IDs
    if (this.processedMessageIds.size > PROCESSED_IDS_HIGH_WATER) {
      const sorted = Array.from(this.processedMessageIds).sort(
        (a, b) => parseInt(a, 10) - parseInt(b, 10),
      );
      const toRemove = sorted.slice(0, sorted.length - PROCESSED_IDS_LOW_WATER);
      for (const id of toRemove) {
        this.processedMessageIds.delete(id);
      }
    }

    return messages;
  }

  async sendMessage(chatId: string, message: string): Promise<void> {
    try {
      await this.toolRouter.routeToolCall(this.tools.sendMessage, {
        chat_id: chatId,
        message,
      });
    } catch (error) {
      this.log.error(`Failed to send message to ${chatId}`, { error });
    }
  }

  getMonitoredChatIds(): string[] {
    return [...this.monitoredChatIds];
  }

  async shutdown(): Promise<void> {
    this.processedMessageIds.clear();
    this.monitoredChatIds = [];
    this.botUserId = null;
  }

  // ─── Private helpers ────────────────────────────────────────────

  private async fetchMessages(chatId: string | undefined, limit: number): Promise<ChannelMessage[]> {
    try {
      const args: Record<string, unknown> = { limit };
      if (chatId) args.chat_id = chatId;

      const result = await this.toolRouter.routeToolCall(this.tools.getMessages, args);
      if (!result.success) return [];

      const data = this.extractData<{ messages: ChannelMessage[] }>(result);
      return data?.messages ?? [];
    } catch {
      return [];
    }
  }

  private filterMessages(rawMessages: ChannelMessage[]): IncomingAgentMessage[] {
    const cutoff = new Date(Date.now() - this.maxMessageAgeMs).toISOString();
    const result: IncomingAgentMessage[] = [];

    for (const msg of rawMessages) {
      // Dedup
      if (this.processedMessageIds.has(msg.id)) continue;

      // Bot self-filter
      if (this.botUserId && msg.senderId === this.botUserId) {
        this.processedMessageIds.add(msg.id);
        continue;
      }

      // Empty text
      if (!msg.text || msg.text.trim() === '') continue;

      // Recency
      if (msg.date && msg.date < cutoff) continue;

      // Bot pattern filter
      const trimmed = msg.text.trim();
      if (this.botPatterns.some((p) => trimmed.startsWith(p))) {
        this.log.debug(`Skipping bot-like message: "${trimmed.substring(0, 50)}..."`);
        this.processedMessageIds.add(msg.id);
        continue;
      }

      // Mark as processed and emit
      this.processedMessageIds.add(msg.id);
      result.push({
        id: msg.id,
        chatId: msg.chatId,
        senderId: msg.senderId,
        text: msg.text,
        date: msg.date,
        channel: this.channel,
        agentId: 'main', // Resolved later by MessageRouter
      });
    }

    return result;
  }

  private async refreshMonitoredChats(): Promise<void> {
    // Try subscriptions first
    if (this.hasSubscribeChat) {
      try {
        const result = await this.toolRouter.routeToolCall(this.tools.subscribeChat, { action: 'list' });
        if (result.success) {
          const data = this.extractData<{ subscriptions: string[] }>(result);
          const subs = data?.subscriptions ?? [];
          if (subs.length > 0) {
            this.monitoredChatIds = subs.filter((id) => id !== this.botUserId);
            this.log.info(`Monitoring ${this.monitoredChatIds.length} subscribed chat(s)`);
            return;
          }
        }
      } catch {
        this.log.warn('subscribe_chat failed, trying list_chats fallback');
      }
    }

    // Fallback: auto-discover chats
    if (this.hasListChats) {
      try {
        const result = await this.toolRouter.routeToolCall(this.tools.listChats, { limit: 20 });
        if (result.success) {
          const data = this.extractData<{ chats: ChannelChat[] }>(result);
          const chats = data?.chats ?? [];
          const chatIds = chats
            .filter((c) => c.type === 'user' && c.id !== this.botUserId)
            .map((c) => c.id);

          if (chatIds.length > 0) {
            this.monitoredChatIds = chatIds;
            this.log.info(`Auto-discovered ${chatIds.length} chat(s) to monitor`);
          } else {
            this.log.warn('No chats found to monitor');
            this.monitoredChatIds = [];
          }
        }
      } catch {
        this.log.error('list_chats failed');
      }
    }
  }

  /**
   * Extract typed data from a ToolRouter result.
   * Unwraps the MCP response envelope and optional StandardResponse wrapper.
   */
  private extractData<T>(result: { success: boolean; content?: unknown; error?: string }): T | null {
    try {
      const mcpResponse = result.content as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = mcpResponse?.content?.[0]?.text;
      if (!text) return null;
      const parsed = JSON.parse(text) as { success?: boolean; data?: T } & T;
      if (parsed.data !== undefined && 'success' in parsed) {
        return parsed.data;
      }
      return parsed;
    } catch {
      return null;
    }
  }
}
