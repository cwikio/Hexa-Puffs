/**
 * SlashCommandHandler — intercepts /commands from Telegram before they reach the LLM.
 * Fast, deterministic, zero-token responses for operational tasks.
 */

import type { ToolRouter } from './tool-router.js';
import type { Orchestrator, OrchestratorStatus, MCPServerStatus } from './orchestrator.js';
import type { AgentStatus } from './agent-manager.js';
import type { IncomingAgentMessage } from './agent-types.js';
import { logger, Logger } from '@mcp/shared/Utils/logger.js';

export interface SlashCommandResult {
  handled: boolean;
  response?: string;
  error?: string;
}

interface TelegramMessage {
  id: number;
  chatId: string;
  senderId?: string;
  text: string;
  date: string; // ISO 8601
}

const MAX_FETCH_MESSAGES = 500;
const BATCH_SIZE = 100;
const MAX_DELETE_HOURS = 168; // 1 week
const MAX_DELETE_COUNT = 500;

export class SlashCommandHandler {
  private toolRouter: ToolRouter;
  private orchestrator: Orchestrator;
  private logger: Logger;

  constructor(toolRouter: ToolRouter, orchestrator: Orchestrator) {
    this.toolRouter = toolRouter;
    this.orchestrator = orchestrator;
    this.logger = logger.child('slash-commands');
  }

  async tryHandle(msg: IncomingAgentMessage): Promise<SlashCommandResult> {
    const text = msg.text.trim();
    if (!text.startsWith('/')) {
      return { handled: false };
    }

    const spaceIndex = text.indexOf(' ');
    const command = (spaceIndex === -1 ? text : text.slice(0, spaceIndex)).toLowerCase();
    const args = spaceIndex === -1 ? '' : text.slice(spaceIndex + 1).trim();

    try {
      switch (command) {
        case '/status':
          return { handled: true, response: this.handleStatus() };

        case '/delete':
          return { handled: true, response: await this.handleDelete(msg.chatId, args) };

        case '/help':
          return { handled: true, response: this.handleHelp() };

        default:
          return { handled: false };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Slash command failed: ${command}`, { error });
      return { handled: true, error: `Command failed: ${message}` };
    }
  }

  private handleStatus(): string {
    const status = this.orchestrator.getStatus();
    const toolCount = this.orchestrator.getAvailableTools().length;

    const uptime = this.formatUptime(status.uptime);
    const state = status.ready ? 'Ready' : 'Initializing';

    let output = `System Status\nUptime: ${uptime} | Status: ${state}\n`;

    // MCP Services
    output += '\nMCP Services:\n';
    const mcpEntries = Object.entries(status.mcpServers);
    if (mcpEntries.length === 0) {
      output += '  (none)\n';
    } else {
      for (const [name, info] of mcpEntries) {
        const state = info.available ? 'up' : 'DOWN';
        const transport = info.port ? `${info.type}:${info.port}` : info.type;
        output += `  ${name}: ${state} (${transport})\n`;
      }
    }

    // Agents
    output += '\nAgents:\n';
    if (status.agents.length === 0) {
      output += '  (none)\n';
    } else {
      for (const agent of status.agents) {
        let state = agent.available ? 'up' : 'DOWN';
        if (agent.paused) state = `PAUSED (${agent.pauseReason || 'unknown'})`;
        output += `  ${agent.agentId}: ${state} (port ${agent.port}, ${agent.restartCount} restarts)\n`;
      }
    }

    // Summary
    output += `\nTools: ${toolCount} | Sessions: ${status.sessions.activeSessions} active`;
    if (status.security.blockedCount > 0) {
      output += ` | Blocked: ${status.security.blockedCount}`;
    }

    return output;
  }

  private async handleDelete(chatId: string, args: string): Promise<string> {
    const parsed = this.parseDeleteArgs(args);

    switch (parsed.type) {
      case 'today':
        return this.deleteByTime(chatId, this.getStartOfToday());

      case 'hours':
        return this.deleteByTime(chatId, new Date(Date.now() - parsed.value * 60 * 60 * 1000));

      case 'count':
        return this.deleteLastN(chatId, parsed.value);

      case 'invalid':
        return parsed.reason;
    }
  }

  private parseDeleteArgs(
    args: string
  ):
    | { type: 'today' }
    | { type: 'hours'; value: number }
    | { type: 'count'; value: number }
    | { type: 'invalid'; reason: string } {
    const trimmed = args.trim().toLowerCase();

    if (!trimmed) {
      return { type: 'invalid', reason: 'Usage: /delete today | /delete <N>h | /delete <N>' };
    }

    if (trimmed === 'today') {
      return { type: 'today' };
    }

    // Match "Nh" pattern (e.g. "2h", "24h")
    const hoursMatch = trimmed.match(/^(\d+)h$/);
    if (hoursMatch) {
      const hours = parseInt(hoursMatch[1], 10);
      if (hours < 1 || hours > MAX_DELETE_HOURS) {
        return { type: 'invalid', reason: `Hours must be between 1 and ${MAX_DELETE_HOURS}.` };
      }
      return { type: 'hours', value: hours };
    }

    // Match plain number (e.g. "50")
    const countMatch = trimmed.match(/^(\d+)$/);
    if (countMatch) {
      const count = parseInt(countMatch[1], 10);
      if (count < 1 || count > MAX_DELETE_COUNT) {
        return { type: 'invalid', reason: `Count must be between 1 and ${MAX_DELETE_COUNT}.` };
      }
      return { type: 'count', value: count };
    }

    return { type: 'invalid', reason: 'Usage: /delete today | /delete <N>h | /delete <N>' };
  }

  private async deleteByTime(chatId: string, cutoff: Date): Promise<string> {
    const allMessages = await this.fetchMessages(chatId, MAX_FETCH_MESSAGES);

    const toDelete = allMessages.filter((msg) => new Date(msg.date) >= cutoff);

    if (toDelete.length === 0) {
      return 'No messages found in the specified time range.';
    }

    const deleted = await this.deleteMessageBatch(
      chatId,
      toDelete.map((m) => m.id)
    );
    return `Deleted ${deleted} message(s).`;
  }

  private async deleteLastN(chatId: string, count: number): Promise<string> {
    const capped = Math.min(count, MAX_DELETE_COUNT);
    const messages = await this.fetchMessages(chatId, capped);

    if (messages.length === 0) {
      return 'No messages found to delete.';
    }

    const deleted = await this.deleteMessageBatch(
      chatId,
      messages.map((m) => m.id)
    );
    return `Deleted ${deleted} message(s).`;
  }

  private async fetchMessages(chatId: string, maxMessages: number): Promise<TelegramMessage[]> {
    const allMessages: TelegramMessage[] = [];
    let offsetId: number | undefined;

    while (allMessages.length < maxMessages) {
      const remaining = maxMessages - allMessages.length;
      const limit = Math.min(BATCH_SIZE, remaining);

      const args: Record<string, unknown> = { chat_id: chatId, limit };
      if (offsetId !== undefined) args.offset_id = offsetId;

      const result = await this.toolRouter.routeToolCall('telegram_get_messages', args);
      if (!result.success) {
        this.logger.error('Failed to fetch messages', { error: result.error });
        break;
      }

      const data = this.extractData<{ messages: TelegramMessage[] }>(result);
      const messages = data?.messages ?? [];
      if (messages.length === 0) break;

      allMessages.push(...messages);

      // offset_id for next page: lowest message ID from current batch
      offsetId = Math.min(...messages.map((m) => m.id));

      if (messages.length < limit) break;
    }

    return allMessages;
  }

  private async deleteMessageBatch(chatId: string, messageIds: number[]): Promise<number> {
    let totalDeleted = 0;

    for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
      const chunk = messageIds.slice(i, i + BATCH_SIZE);
      const result = await this.toolRouter.routeToolCall('telegram_delete_messages', {
        chat_id: chatId,
        message_ids: chunk,
      });

      if (result.success) {
        totalDeleted += chunk.length;
      } else {
        this.logger.error(`Failed to delete batch at index ${i}`, { error: result.error });
        break;
      }
    }

    return totalDeleted;
  }

  private handleHelp(): string {
    return [
      'Available commands:',
      '  /status — System status (MCPs, agents, tools)',
      '  /delete today — Delete messages from today',
      '  /delete <N>h — Delete messages from last N hours',
      '  /delete <N> — Delete last N messages',
      '  /help — Show this help',
    ].join('\n');
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  private getStartOfToday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  /**
   * Extract typed data from a ToolRouter result.
   * Same pattern as ChannelPoller.extractData().
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
