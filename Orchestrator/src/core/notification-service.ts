/**
 * NotificationService — sends Telegram notifications for startup, hot-reload, and validation errors.
 *
 * Extracted from Orchestrator to separate notification side-effects from core logic.
 */

import type { ToolRouter } from '../routing/tool-router.js';
import type { AgentDefinition } from '../config/agents.js';
import type { Config } from '../config/schema.js';
import type { IMCPClient } from '../mcp-clients/types.js';
import type { MCPDiff } from './startup-diff.js';
import type { ExternalMCPEntry } from '@mcp/shared/Discovery/external-loader.js';
import { Logger } from '@mcp/shared/Utils/logger.js';

export interface NotificationDeps {
  toolRouter: ToolRouter;
  getAgentDefinition: (id: string) => AgentDefinition | undefined;
}

/** Snapshot of Orchestrator state needed for startup notifications. */
export interface StartupContext {
  stdioClients: Map<string, IMCPClient>;
  httpClients: Map<string, IMCPClient>;
  externalMCPNames: Set<string>;
  config: Config;
}

export class NotificationService {
  private readonly logger: Logger;

  constructor(private deps: NotificationDeps) {
    this.logger = new Logger('orchestrator:notifications');
  }

  /**
   * Send a Telegram notification summarizing the startup state.
   */
  async sendStartupNotification(diff: MCPDiff, ctx: StartupContext): Promise<void> {
    const chatId = this.getNotifyChatId();
    if (!chatId) {
      this.logger.debug('No chat ID for startup notification — skipping');
      return;
    }

    const internalCount = [...ctx.stdioClients.keys()].filter(
      (n) => !ctx.externalMCPNames.has(n),
    ).length;
    const externalCount = ctx.externalMCPNames.size;
    const total = ctx.stdioClients.size + ctx.httpClients.size;

    // Build tool names per MCP
    const toolsByMCP = new Map<string, string[]>();
    for (const route of this.deps.toolRouter.getAllRoutes()) {
      const list = toolsByMCP.get(route.mcpName) ?? [];
      list.push(route.originalName);
      toolsByMCP.set(route.mcpName, list);
    }

    const lines: string[] = [
      'Orchestrator started',
      `MCPs: ${total} total (${internalCount} internal, ${externalCount} external)`,
    ];

    if (externalCount > 0) {
      lines.push('', 'External:');
      for (const name of ctx.externalMCPNames) {
        const tools = toolsByMCP.get(name) ?? [];
        const transport = ctx.httpClients.has(name) ? 'http' : 'stdio';
        const desc = ctx.config.mcpServersStdio?.[name]?.description
          ?? ctx.config.mcpServersHttp?.[name]?.description;
        lines.push(desc
          ? `  ${name} (${transport}): ${tools.length} tools — ${desc}`
          : `  ${name} (${transport}): ${tools.length} tools`);
        for (const tool of tools) {
          lines.push(`    • ${tool}`);
        }
      }
    }

    if (diff.added.length > 0 || diff.removed.length > 0) {
      lines.push('', 'Changes since last boot:');
      for (const name of diff.added) lines.push(`  + ${name}`);
      for (const name of diff.removed) lines.push(`  - ${name}`);
    }

    const failedEntries: Array<{ name: string; error?: string }> = [
      ...[...ctx.stdioClients.entries()]
        .filter(([, c]) => !c.isAvailable)
        .map(([n, c]) => ({ name: n, error: c.initError })),
      ...[...ctx.httpClients.entries()]
        .filter(([, c]) => !c.isAvailable)
        .map(([n, c]) => ({ name: n, error: c.initError })),
    ];
    if (failedEntries.length > 0) {
      lines.push('', 'Failed:');
      for (const { name, error } of failedEntries) {
        lines.push(error ? `  ${name}: ${error}` : `  ${name}`);
      }
    }

    const blocked = this.deps.toolRouter.getBlockedTools();
    if (blocked.length > 0) {
      lines.push('', 'Safety: The following destructive tools were blocked by default:');
      for (const tool of blocked) lines.push(`  - ${tool}`);
      lines.push('', 'To enable them, add "allowDestructiveTools": true to the MCP metadata in external-mcps.json');
    }

    const message = lines.join('\n');

    try {
      await this.deps.toolRouter.routeToolCall('telegram_send_message', {
        chat_id: chatId,
        message,
      });
    } catch (err) {
      this.logger.warn('Failed to send startup notification via Telegram', { error: err });
    }
  }

  /**
   * Send a Telegram notification about external MCP hot-reload changes.
   */
  async sendHotReloadNotification(
    added: Map<string, ExternalMCPEntry>,
    removed: string[],
    failed: Array<{ name: string; error: string }>,
  ): Promise<void> {
    const chatId = this.getNotifyChatId();
    if (!chatId) return;

    const lines: string[] = ['External MCPs changed:'];

    const failedNames = new Set(failed.map((f) => f.name));
    for (const [name, entry] of added) {
      if (failedNames.has(name)) continue;
      const tools = this.deps.toolRouter.getAllRoutes().filter((r) => r.mcpName === name);
      lines.push(entry.description
        ? `  + ${name} (${entry.type}): ${tools.length} tools — ${entry.description}`
        : `  + ${name} (${entry.type}): ${tools.length} tools`);
      for (const tool of tools) {
        lines.push(`    • ${tool.originalName}`);
      }
    }
    for (const name of removed) {
      lines.push(`  - ${name}`);
    }
    if (failed.length > 0) {
      lines.push('', 'Failed to connect:');
      for (const { name, error } of failed) {
        lines.push(`  ${name}: ${error}`);
      }
    }

    try {
      await this.deps.toolRouter.routeToolCall('telegram_send_message', {
        chat_id: chatId,
        message: lines.join('\n'),
      });
    } catch (err) {
      this.logger.warn('Failed to send hot-reload notification via Telegram', { error: err });
    }
  }

  /**
   * Send Telegram notification about external MCP validation errors.
   */
  async sendValidationErrorNotification(
    fileError: string | undefined,
    entryErrors: Array<{ name: string; message: string }>,
  ): Promise<void> {
    const chatId = this.getNotifyChatId();
    if (!chatId) return;

    const lines: string[] = ['External MCPs validation error:'];
    if (fileError) {
      lines.push(`  File: ${fileError}`);
    }
    for (const err of entryErrors) {
      lines.push(`  "${err.name}": ${err.message}`);
    }
    lines.push('', 'Valid entries were still loaded. Fix the errors above and save the file.');

    try {
      await this.deps.toolRouter.routeToolCall('telegram_send_message', {
        chat_id: chatId,
        message: lines.join('\n'),
      });
    } catch (err) {
      this.logger.warn('Failed to send validation error notification via Telegram', { error: err });
    }
  }

  private getNotifyChatId(): string | undefined {
    const agentDef = this.deps.getAgentDefinition('hexa-puffs');
    return agentDef?.costControls?.notifyChatId || process.env.NOTIFY_CHAT_ID;
  }
}
