/**
 * ChannelPoller - Polls messaging channels for new messages and emits them.
 *
 * Extracted from Thinker's polling logic. Uses the ToolRouter to call
 * Telegram MCP tools (get_messages, list_chats, get_me) so it works
 * with both stdio and HTTP MCP connections.
 */

import { logger, Logger } from '@mcp/shared/Utils/logger.js';
import type { ToolRouter } from './tool-router.js';
import type { IncomingAgentMessage } from './agent-types.js';

interface TelegramMessage {
  id: string;
  chatId: string;
  senderId: string;
  text: string;
  date: string;
  isOutgoing: boolean;
}

interface TelegramChat {
  id: string;
  type: string;
  title: string;
  unreadCount: number;
}

export interface ChannelPollerConfig {
  intervalMs: number;
  maxMessagesPerCycle: number;
}

export class ChannelPoller {
  private toolRouter: ToolRouter;
  private config: ChannelPollerConfig;
  private logger: Logger;

  // Polling state
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private processedMessageIds: Set<string> = new Set();
  private botUserId: string | null = null;
  private monitoredChatIds: string[] = [];
  private lastChatRefresh = 0;
  private polling = false;

  // Patterns that indicate bot-generated messages (prevents feedback loops)
  private readonly botMessagePatterns = [
    'I encountered an error:',
    'I apologize, but I was unable to',
    'Failed after',
    'rate limit issue cannot be resolved',
    'Invalid API Key',
    'I was unable to generate a response',
    "Sorry, I couldn't complete that request",
  ];

  // Callback for dispatching discovered messages
  onMessage: ((msg: IncomingAgentMessage) => Promise<void>) | null = null;

  constructor(toolRouter: ToolRouter, config: ChannelPollerConfig) {
    this.toolRouter = toolRouter;
    this.config = config;
    this.logger = logger.child('channel-poller');
  }

  /**
   * Initialize the poller: discover bot identity.
   */
  async initialize(): Promise<void> {
    // Fetch bot user ID to filter out its own messages
    try {
      const result = await this.toolRouter.routeToolCall('telegram_get_me', {});
      if (result.success) {
        const data = this.extractData<{ user: { id: string } }>(result);
        if (data?.user?.id) {
          this.botUserId = data.user.id;
          this.logger.info(`Bot user ID: ${this.botUserId}`);
        }
      }
    } catch (error) {
      this.logger.warn('Could not fetch bot user ID — bot message filtering disabled');
    }

    // Initial chat discovery
    await this.refreshMonitoredChats();
  }

  /**
   * Start the polling loop.
   */
  start(): void {
    if (this.pollTimer) return;

    this.logger.info(`Starting channel polling (interval: ${this.config.intervalMs}ms)`);

    // Initial poll
    this.pollCycle();

    this.pollTimer = setInterval(() => {
      this.pollCycle();
    }, this.config.intervalMs);

    // Don't keep the process alive just for polling
    if (this.pollTimer.unref) {
      this.pollTimer.unref();
    }
  }

  /**
   * Stop the polling loop.
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      this.logger.info('Channel polling stopped');
    }
  }

  /**
   * Single poll cycle: fetch messages, filter, dispatch.
   */
  private async pollCycle(): Promise<void> {
    // Prevent overlapping poll cycles
    if (this.polling) return;
    this.polling = true;

    try {
      // Refresh monitored chats every 5 minutes
      if (this.monitoredChatIds.length === 0 || Date.now() - this.lastChatRefresh > 5 * 60 * 1000) {
        await this.refreshMonitoredChats();
        this.lastChatRefresh = Date.now();
      }

      let totalDispatched = 0;

      for (const chatId of this.monitoredChatIds) {
        const messages = await this.fetchRecentMessages(chatId, 5);

        // Filter to new, incoming, recent messages
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const newMessages = messages.filter((msg) => {
          if (this.processedMessageIds.has(msg.id)) return false;
          if (this.botUserId && msg.senderId === this.botUserId) return false;
          if (!msg.text || msg.text.trim() === '') return false;
          if (msg.date && msg.date < twoMinutesAgo) return false;
          const textToCheck = msg.text.trim();
          if (this.botMessagePatterns.some((p) => textToCheck.startsWith(p))) {
            this.logger.debug(`Skipping bot-like message: "${textToCheck.substring(0, 50)}..."`);
            return false;
          }
          return true;
        });

        // Sort oldest first, cap per cycle
        const sorted = newMessages
          .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10))
          .slice(0, this.config.maxMessagesPerCycle);

        for (const msg of sorted) {
          // Mark as processed BEFORE dispatching to avoid duplicates
          this.processedMessageIds.add(msg.id);

          if (this.onMessage) {
            const agentMessage: IncomingAgentMessage = {
              id: msg.id,
              chatId: msg.chatId,
              senderId: msg.senderId,
              text: msg.text,
              date: msg.date,
              channel: 'telegram',
              agentId: 'main', // Phase 1: always default agent. Phase 3: resolved by MessageRouter
            };

            this.logger.info(`Dispatching message from chat ${msg.chatId}: "${msg.text.substring(0, 50)}..."`);
            await this.onMessage(agentMessage);
            totalDispatched++;
          }
        }

        // Also mark bot's own messages as processed
        for (const msg of messages) {
          if (this.botUserId && msg.senderId === this.botUserId) {
            this.processedMessageIds.add(msg.id);
          }
        }
      }

      if (totalDispatched > 0) {
        this.logger.info(`Poll cycle: dispatched ${totalDispatched} message(s)`);
      }

      // Cleanup old processed IDs (keep last 500)
      if (this.processedMessageIds.size > 1000) {
        const sorted = Array.from(this.processedMessageIds).sort(
          (a, b) => parseInt(a, 10) - parseInt(b, 10)
        );
        const toRemove = sorted.slice(0, sorted.length - 500);
        for (const id of toRemove) {
          this.processedMessageIds.delete(id);
        }
      }
    } catch (error) {
      this.logger.error('Error in poll cycle:', error);
    } finally {
      this.polling = false;
    }
  }

  /**
   * Refresh the list of monitored Telegram chats via ToolRouter.
   */
  private async refreshMonitoredChats(): Promise<void> {
    try {
      // Try subscriptions first
      const subResult = await this.toolRouter.routeToolCall('telegram_subscribe_chat', {
        action: 'list',
      });

      if (subResult.success) {
        const data = this.extractData<{ subscriptions: string[] }>(subResult);
        const subscriptions = data?.subscriptions ?? [];

        if (subscriptions.length > 0) {
          this.monitoredChatIds = subscriptions.filter((id) => id !== this.botUserId);
          this.logger.info(`Monitoring ${this.monitoredChatIds.length} subscribed chat(s)`);
          return;
        }
      }

      // Fallback: auto-discover private chats
      const chatResult = await this.toolRouter.routeToolCall('telegram_list_chats', { limit: 20 });
      if (chatResult.success) {
        const data = this.extractData<{ chats: TelegramChat[] }>(chatResult);
        const chats = data?.chats ?? [];

        const privateChatIds = chats
          .filter((chat) => chat.type === 'user' && chat.id !== this.botUserId)
          .map((chat) => chat.id);

        if (privateChatIds.length > 0) {
          this.monitoredChatIds = privateChatIds;
          this.logger.info(`Auto-discovered ${privateChatIds.length} chat(s) to monitor`);
        } else {
          this.logger.warn('No chats found to monitor');
          this.monitoredChatIds = [];
        }
      }
    } catch (error) {
      this.logger.error('Error refreshing monitored chats:', error);
    }
  }

  /**
   * Fetch recent messages from a specific chat via ToolRouter.
   */
  private async fetchRecentMessages(chatId: string, limit: number): Promise<TelegramMessage[]> {
    try {
      const result = await this.toolRouter.routeToolCall('telegram_get_messages', {
        chat_id: chatId,
        limit,
      });

      if (!result.success) return [];

      const data = this.extractData<{ messages: TelegramMessage[] }>(result);
      return data?.messages ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Extract typed data from a ToolRouter result.
   *
   * The ToolRouter wraps MCP responses as:
   *   { success: true, content: { content: [{ type: 'text', text: JSON.stringify(data) }] } }
   */
  private extractData<T>(result: { success: boolean; content?: unknown; error?: string }): T | null {
    try {
      const mcpResponse = result.content as {
        content?: Array<{ type: string; text?: string }>;
      };
      const text = mcpResponse?.content?.[0]?.text;
      if (!text) return null;
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }
}
