/**
 * SlashCommandHandler — intercepts /commands from Telegram before they reach the LLM.
 * Fast, deterministic, zero-token responses for operational tasks.
 */

import { readdir, stat, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { ToolRouter } from './tool-router.js';
import type { Orchestrator, OrchestratorStatus, MCPServerStatus } from './orchestrator.js';
import type { AgentStatus } from './agent-manager.js';
import type { IncomingAgentMessage } from './agent-types.js';
import { guardianConfig } from '../config/guardian.js';
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
const MAX_ENTRIES_COUNT = 50;
const DEFAULT_SECURITY_ENTRIES = 10;
const DEFAULT_LOG_ENTRIES = 15;
const LOGS_DIR = join(homedir(), '.annabelle', 'logs');

/** Service log files to scan for /logs N (WARN/ERROR filtering) */
const SERVICE_LOG_FILES = [
  'orchestrator.log',
  'thinker.log',
  'gmail.log',
  'telegram.log',
  'searcher.log',
  'filer.log',
  'memorizer.log',
  'ollama.log',
];

interface ScanLogEntry {
  scan_id: string;
  timestamp: string;
  source: string;
  safe: boolean;
  confidence?: number;
  threats: Array<{ type: string; snippet?: string }> | string[];
  content_hash: string;
}

interface ScanLogResult {
  scans: ScanLogEntry[];
  total: number;
}

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

        case '/info':
          return { handled: true, response: await this.handleInfo() };

        case '/security':
          return { handled: true, response: await this.handleSecurity(args) };

        case '/logs':
          return { handled: true, response: await this.handleLogs(args) };

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

  private async handleInfo(): Promise<string> {
    const status = this.orchestrator.getStatus();
    const tools = this.orchestrator.getAvailableTools();

    // Group tools by MCP
    const toolsByMcp = new Map<string, string[]>();
    for (const toolName of tools) {
      const prefix = toolName.includes('_') ? toolName.split('_')[0] : 'other';
      const list = toolsByMcp.get(prefix) ?? [];
      list.push(toolName);
      toolsByMcp.set(prefix, list);
    }

    let output = 'Annabelle Info\n\n';

    // Slash commands
    output += 'Commands:\n';
    output += '  /status — System status (MCPs, agents, uptime)\n';
    output += '  /info — This info page (commands, tools, skills)\n';
    output += '  /delete — Delete messages (today | <N>h | <N>)\n';
    output += '  /security — Guardian status & scan config\n';
    output += '  /security [N] — Last N security threats (default 10)\n';
    output += '  /logs — Log file sizes & freshness\n';
    output += '  /logs [N] — Last N warnings/errors (default 15)\n';
    output += '  /help — Short command list\n';

    // MCP services + tool counts
    output += '\nMCP Services:\n';
    const mcpEntries = Object.entries(status.mcpServers);
    for (const [name, info] of mcpEntries) {
      const state = info.available ? 'up' : 'DOWN';
      const count = toolsByMcp.get(name)?.length ?? 0;
      output += `  ${name}: ${state} (${count} tools)\n`;
    }
    output += `  Total: ${tools.length} tools\n`;

    // Skills from memory
    try {
      const result = await this.toolRouter.routeToolCall('memory_list_skills', {
        agent_id: 'annabelle',
        enabled: true,
      });

      if (result.success) {
        const data = this.extractData<{ skills: Array<{ name: string; description?: string; trigger_type: string }> }>(result);
        const skills = data?.skills ?? [];

        if (skills.length > 0) {
          output += '\nSkills:\n';
          for (const skill of skills) {
            const trigger = skill.trigger_type === 'cron' ? 'cron' : skill.trigger_type;
            const desc = skill.description ? ` — ${skill.description}` : '';
            output += `  ${skill.name} [${trigger}]${desc}\n`;
          }
        } else {
          output += '\nSkills: (none)\n';
        }
      }
    } catch {
      output += '\nSkills: (unavailable)\n';
    }

    return output;
  }

  // ─── /security ───────────────────────────────────────────────

  private async handleSecurity(args: string): Promise<string> {
    const count = this.parseEntryCount(args, DEFAULT_SECURITY_ENTRIES);
    if (count !== null) return this.handleSecurityEntries(count);
    return this.handleSecurityStatus();
  }

  private async handleSecurityStatus(): Promise<string> {
    const status = this.orchestrator.getStatus();
    const guardianStatus = status.mcpServers.guardian;
    const available = guardianStatus?.available ?? false;

    let output = 'Guardian Security\n';
    output += `Status: ${guardianConfig.enabled ? 'enabled' : 'disabled'}`;
    output += ` | Fail mode: ${guardianConfig.failMode}`;
    output += `\nGuardian MCP: ${available ? 'available' : 'unavailable'}\n`;

    // Input scanning flags
    output += '\nInput scanning:\n';
    output += this.formatScanFlags(guardianConfig.input);

    // Output scanning flags
    output += '\nOutput scanning:\n';
    output += this.formatScanFlags(guardianConfig.output);

    // 24h stats from scan log
    if (available) {
      try {
        const result = await this.orchestrator.callGuardianTool('get_scan_log', { limit: 1000 });
        if (result?.success) {
          const data = this.extractData<ScanLogResult>(result);
          const scans = data?.scans ?? [];

          const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const recent = scans.filter((s) => new Date(s.timestamp) >= cutoff);
          const threats = recent.filter((s) => !s.safe);
          const pct = recent.length > 0 ? ((threats.length / recent.length) * 100).toFixed(1) : '0.0';

          output += `\nLast 24h: ${recent.length} scans, ${threats.length} threats (${pct}%)`;
        }
      } catch {
        output += '\nLast 24h: (stats unavailable)';
      }
    }

    return output;
  }

  private async handleSecurityEntries(count: number): Promise<string> {
    const result = await this.orchestrator.callGuardianTool('get_scan_log', {
      limit: count,
      threats_only: true,
    });

    if (!result) return 'Guardian MCP is unavailable.';
    if (!result.success) return `Failed to retrieve scan log: ${result.error}`;

    const data = this.extractData<ScanLogResult>(result);
    const scans = data?.scans ?? [];

    if (scans.length === 0) return 'No security threats found.';

    let output = `Security Threats (last ${scans.length})\n`;

    for (const scan of scans) {
      const ts = this.formatShortTimestamp(scan.timestamp);
      const threat = this.extractThreatInfo(scan);
      output += `\n[${ts}] ${scan.source} — ${threat.type}`;
      if (threat.confidence) output += ` (${threat.confidence})`;
      if (threat.snippet) output += `\n  "${threat.snippet}"`;
    }

    output += `\n\nShowing ${scans.length} threat(s)`;
    return output;
  }

  private formatScanFlags(flags: Record<string, boolean>): string {
    const entries = Object.entries(flags);
    const parts: string[] = [];
    for (const [name, enabled] of entries) {
      parts.push(`${name}: ${enabled ? 'on' : 'off'}`);
    }
    // Format in rows of 3
    let result = '';
    for (let i = 0; i < parts.length; i += 3) {
      result += '  ' + parts.slice(i, i + 3).join(' | ') + '\n';
    }
    return result;
  }

  private extractThreatInfo(scan: ScanLogEntry): { type: string; confidence?: string; snippet?: string } {
    const threats = scan.threats;
    if (!threats || threats.length === 0) return { type: 'unknown' };

    const first = threats[0];
    // get_scan_log returns threats as either strings or objects
    if (typeof first === 'string') {
      return {
        type: first,
        confidence: scan.confidence?.toFixed(2),
      };
    }

    return {
      type: first.type ?? 'unknown',
      confidence: scan.confidence?.toFixed(2),
      snippet: first.snippet ? first.snippet.slice(0, 60) : undefined,
    };
  }

  // ─── /logs ──────────────────────────────────────────────────

  private async handleLogs(args: string): Promise<string> {
    const count = this.parseEntryCount(args, DEFAULT_LOG_ENTRIES);
    if (count !== null) return this.handleLogEntries(count);
    return this.handleLogStatus();
  }

  private async handleLogStatus(): Promise<string> {
    let files: Array<{ name: string; size: number; mtime: Date }>;
    try {
      const entries = await readdir(LOGS_DIR);
      const stats = await Promise.all(
        entries
          .filter((name) => !name.startsWith('build-'))
          .map(async (name) => {
            const s = await stat(join(LOGS_DIR, name));
            return { name, size: s.size, mtime: s.mtime };
          })
      );
      files = stats.sort((a, b) => b.size - a.size);
    } catch {
      return `Cannot read log directory: ${LOGS_DIR}`;
    }

    if (files.length === 0) return 'No log files found.';

    let output = `System Logs (${LOGS_DIR})\n\n`;
    let totalSize = 0;

    for (const file of files) {
      totalSize += file.size;
      const size = this.formatFileSize(file.size).padStart(10);
      const ago = this.formatTimeAgo(file.mtime);
      output += `  ${file.name.padEnd(24)} ${size}   ${ago}\n`;
    }

    output += `\nTotal: ${this.formatFileSize(totalSize)} across ${files.length} files`;
    return output;
  }

  private async handleLogEntries(count: number): Promise<string> {
    const allEntries: Array<{ timestamp: Date; service: string; level: string; message: string }> = [];

    for (const filename of SERVICE_LOG_FILES) {
      try {
        const content = await readFile(join(LOGS_DIR, filename), 'utf-8');
        const lines = content.split('\n');
        // Read from the end for efficiency — take last 200 lines
        const recent = lines.slice(-200);

        const service = basename(filename, '.log');
        for (const line of recent) {
          const match = line.match(/^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\]\s+\[(WARN|ERROR)\]\s+(?:\[.*?\]\s+)?(.*)$/);
          if (match) {
            allEntries.push({
              timestamp: new Date(match[1]),
              service,
              level: match[2],
              message: match[3].trim(),
            });
          }
        }
      } catch {
        // File doesn't exist or can't be read — skip
      }
    }

    if (allEntries.length === 0) return 'No recent warnings or errors found.';

    // Sort by timestamp descending, take the requested count
    allEntries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    const entries = allEntries.slice(0, count);

    let output = `Recent Issues (last ${entries.length})\n`;

    for (const entry of entries) {
      const ts = this.formatShortTimestamp(entry.timestamp.toISOString());
      const msg = entry.message.length > 80 ? entry.message.slice(0, 80) + '...' : entry.message;
      output += `\n[${ts}] ${entry.service}: ${msg}`;
    }

    output += `\n\nShowing ${entries.length} of ${allEntries.length} warnings/errors`;
    return output;
  }

  // ─── shared helpers ─────────────────────────────────────────

  /**
   * Parse args as an entry count for /security N and /logs N.
   * Returns the count if args is a valid number, null if args is empty/non-numeric (show status).
   * Throws on out-of-range values.
   */
  private parseEntryCount(args: string, defaultCount: number): number | null {
    const trimmed = args.trim();
    if (!trimmed) return null;

    const match = trimmed.match(/^(\d+)$/);
    if (!match) return null;

    const count = parseInt(match[1], 10);
    if (count < 1 || count > MAX_ENTRIES_COUNT) {
      throw new Error(`Count must be between 1 and ${MAX_ENTRIES_COUNT}.`);
    }
    return count;
  }

  private formatShortTimestamp(iso: string): string {
    const d = new Date(iso);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
  }

  private formatFileSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  }

  private formatTimeAgo(date: Date): string {
    const diffMs = Date.now() - date.getTime();
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
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
      const parsed = JSON.parse(text) as { success?: boolean; data?: T } & T;
      // Unwrap StandardResponse envelope if present
      if (parsed.data !== undefined && 'success' in parsed) {
        return parsed.data;
      }
      return parsed;
    } catch {
      return null;
    }
  }
}
