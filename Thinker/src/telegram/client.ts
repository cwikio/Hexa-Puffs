import type { TraceContext } from '../tracing/types.js';
import { createTraceHeaders } from '../tracing/context.js';
import type { TelegramMessage } from '../orchestrator/types.js';

/**
 * Response format from Telegram MCP HTTP API
 */
interface TelegramMCPResponse {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/**
 * Parsed response from Telegram MCP
 */
interface ParsedTelegramResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Direct HTTP client for Telegram MCP (bypasses Orchestrator)
 */
export class TelegramDirectClient {
  private baseUrl: string;

  constructor(telegramDirectUrl: string) {
    this.baseUrl = telegramDirectUrl;
  }

  /**
   * Make HTTP request to Telegram MCP
   */
  private async request<T>(
    toolName: string,
    args: Record<string, unknown>,
    trace?: TraceContext
  ): Promise<ParsedTelegramResponse<T>> {
    const url = `${this.baseUrl}/tools/call`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(trace ? createTraceHeaders(trace) : {}),
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: toolName, arguments: args }),
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: false,
          error: `Telegram MCP request failed: ${response.status} - ${error}`,
        };
      }

      const mcpResponse = (await response.json()) as TelegramMCPResponse;

      // Parse MCP response format
      if (!mcpResponse.content || mcpResponse.content.length === 0) {
        return { success: false, error: 'Empty response from Telegram MCP' };
      }

      const textContent = mcpResponse.content[0];
      if (textContent.type !== 'text') {
        return { success: false, error: 'Unexpected response type' };
      }

      try {
        return JSON.parse(textContent.text) as ParsedTelegramResponse<T>;
      } catch {
        return { success: false, error: 'Failed to parse response' };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Check health of Telegram MCP
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      const data = (await response.json()) as { status: string };
      return data.status === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * Get new messages from Telegram
   */
  async getNewMessages(
    peek: boolean = false,
    trace?: TraceContext
  ): Promise<TelegramMessage[]> {
    const response = await this.request<{
      messages: TelegramMessage[];
      count: number;
    }>('get_new_messages', { peek }, trace);

    if (!response.success || !response.data) {
      return [];
    }

    return response.data.messages || [];
  }

  /**
   * Send a message to Telegram
   */
  async sendMessage(
    chatId: string,
    message: string,
    replyTo?: number,
    trace?: TraceContext
  ): Promise<boolean> {
    const args: Record<string, unknown> = { chat_id: chatId, message };
    if (replyTo) {
      args.reply_to = replyTo;
    }

    const response = await this.request('send_message', args, trace);
    return response.success;
  }

  /**
   * Subscribe to a chat for real-time messages
   */
  async subscribeChat(chatId: string, trace?: TraceContext): Promise<boolean> {
    const response = await this.request(
      'subscribe_chat',
      { action: 'subscribe', chat_id: chatId },
      trace
    );
    return response.success;
  }

  /**
   * List current subscriptions
   */
  async listSubscriptions(trace?: TraceContext): Promise<string[]> {
    const response = await this.request<{ subscriptions: string[] }>(
      'subscribe_chat',
      { action: 'list' },
      trace
    );
    return response.data?.subscriptions || [];
  }

  /**
   * Clear subscriptions (receive all chats)
   */
  async clearSubscriptions(trace?: TraceContext): Promise<boolean> {
    const response = await this.request(
      'subscribe_chat',
      { action: 'clear' },
      trace
    );
    return response.success;
  }

  /**
   * Get recent messages from a specific chat (direct fetch, bypasses queue)
   * This is more reliable than get_new_messages since it doesn't depend on real-time handlers
   */
  async getRecentMessages(
    chatId: string,
    limit: number = 10,
    trace?: TraceContext
  ): Promise<TelegramMessage[]> {
    const response = await this.request<{
      messages: TelegramMessage[];
      count: number;
    }>('get_messages', { chat_id: chatId, limit }, trace);

    if (!response.success || !response.data) {
      return [];
    }

    return response.data.messages || [];
  }

  /**
   * Get info about the current user (to identify our own messages)
   */
  async getMe(trace?: TraceContext): Promise<{ id: string; username?: string } | null> {
    const response = await this.request<{
      user: { id: string; username?: string; firstName?: string };
    }>('get_me', {}, trace);

    if (!response.success || !response.data) {
      return null;
    }

    return response.data.user;
  }

  /**
   * List available chats (for auto-discovering which chats to monitor)
   */
  async listChats(limit: number = 20, trace?: TraceContext): Promise<Array<{
    id: string;
    type: string;
    title: string;
    unreadCount: number;
  }>> {
    const response = await this.request<{
      count: number;
      chats: Array<{ id: string; type: string; title: string; unreadCount: number }>;
    }>('list_chats', { limit }, trace);
    if (!response.success || !response.data) return [];
    return response.data.chats || [];
  }
}
