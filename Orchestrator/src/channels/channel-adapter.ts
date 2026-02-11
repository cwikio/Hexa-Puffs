/**
 * ChannelAdapter — generic interface for messaging channel integrations.
 *
 * Any MCP with `role: "channel"` in its annabelle manifest is expected to
 * expose tools that a ChannelAdapter can call via the ToolRouter:
 *
 *   Required tools (namespaced as {mcpName}_{toolName}):
 *     send_message   — { chat_id: string, message: string }
 *     get_messages    — { chat_id?: string, limit?: number }
 *
 *   Optional tools (adapter degrades gracefully if absent):
 *     get_me          — returns bot identity for self-message filtering
 *     list_chats      — discover available chats
 *     subscribe_chat  — subscription-based chat filtering
 */

import type { IncomingAgentMessage } from '../agents/agent-types.js';

export interface ChannelAdapterConfig {
  /** String prefixes that indicate bot-generated messages (prevents feedback loops). */
  botPatterns?: string[];
  /** How often to re-discover chats via list_chats/subscribe_chat (ms). Default: 300000 (5 min). */
  chatRefreshIntervalMs?: number;
  /** Only process messages newer than this (ms). Default: 120000 (2 min). */
  maxMessageAgeMs?: number;
}

export interface ChannelAdapter {
  /** Channel identifier — matches mcpName from manifest (e.g., "telegram", "discord"). */
  readonly channel: string;

  /** Initialize the adapter (fetch bot identity, discover chats, etc.). */
  initialize(): Promise<void>;

  /** Poll for new messages since last check. Returns channel-agnostic messages. */
  poll(): Promise<IncomingAgentMessage[]>;

  /** Send a text response back to a specific chat on this channel. */
  sendMessage(chatId: string, message: string): Promise<void>;

  /** Get the list of monitored chat IDs for this channel. */
  getMonitoredChatIds(): string[];

  /** Clean up resources on shutdown. */
  shutdown(): Promise<void>;
}
