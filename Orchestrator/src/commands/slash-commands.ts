/**
 * SlashCommandHandler — intercepts /commands from Telegram before they reach the LLM.
 * Fast, deterministic, zero-token responses for operational tasks.
 */

import { readdir, stat, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { ToolRouter } from '../routing/tool-router.js';
import type { Orchestrator, OrchestratorStatus, MCPServerStatus } from '../core/orchestrator.js';
import type { AgentStatus } from '../agents/agent-manager.js';
import type { IncomingAgentMessage } from '../agents/agent-types.js';
import { guardianConfig } from '../config/guardian.js';
import { JobStorage } from '../jobs/storage.js';
import type { JobDefinition, TaskDefinition } from '../jobs/types.js';
import { getConfig } from '../config/index.js';
import { Cron } from 'croner';
import { logger, Logger } from '@mcp/shared/Utils/logger.js';
import { runDiagnosticChecks, formatDiagnosticOutput } from './diagnostic-checks.js';

const SYSTEM_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

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

/** Human-friendly display names for MCP services */
const MCP_DISPLAY_NAMES: Record<string, string> = {
  guardian: 'Guardian',
  telegram: 'Telegram',
  memory: 'Memory',
  filer: 'Filer',
  searcher: 'Searcher',
  gmail: 'Gmail',
  onepassword: '1Password',
  web: 'Browser',
};

/** Service log files to scan for /logs N (WARN/ERROR filtering).
 * Note: Thinker logs go to orchestrator.log (prefixed [thinker:<id>]) since
 * the Orchestrator spawns Thinker as a child process. No separate thinker.log. */
const SERVICE_LOG_FILES = [
  'orchestrator.log',
  'gmail.log',
  'telegram.log',
  'searcher.log',
  'filer.log',
  'memorizer.log',
  'ollama.log',
  'web.log',
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
          return { handled: true, response: await this.handleStatus(args) };

        case '/delete':
          return { handled: true, response: await this.handleDelete(msg.chatId, args) };

        case '/help':
          return { handled: true, response: await this.handleInfo() };

        case '/security':
          return { handled: true, response: await this.handleSecurity(args) };

        case '/logs':
          return { handled: true, response: await this.handleLogs(args) };

        case '/kill':
          return { handled: true, response: await this.handleKill(args) };

        case '/resume':
          return { handled: true, response: await this.handleResume(args) };

        case '/cron':
          return { handled: true, response: await this.handleCron() };

        case '/browser':
          return { handled: true, response: await this.handleBrowser() };

        case '/diagnose':
          return { handled: true, response: await this.handleDiagnose() };

        default:
          return { handled: false };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Slash command failed: ${command}`, { error });
      return { handled: true, error: `Command failed: ${message}` };
    }
  }

  private async handleStatus(args: string): Promise<string> {
    const trimmed = args.trim().toLowerCase();
    if (trimmed === 'summary') return this.handleStatusSummary();

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
        const label = MCP_DISPLAY_NAMES[name] ?? name;
        const state = info.available ? 'up' : 'DOWN';
        const transport = info.type;
        output += `  ${label}: ${state} (${transport})\n`;
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

    // Telegram & Inngest state
    const haltManager = this.orchestrator.getHaltManager();
    const pollerRunning = this.orchestrator.getChannelManager() !== null;
    const inngestHalted = haltManager.isTargetHalted('inngest');

    output += `\nChannels: ${pollerRunning ? 'polling' : 'stopped'}`;
    output += `\nInngest: ${inngestHalted ? 'halted' : 'active'}`;

    // Browser
    const webMcp = status.mcpServers.web;
    if (webMcp) {
      if (webMcp.available) {
        let browserLine = 'Browser: 1 instance';
        try {
          const tabResult = await Promise.race([
            this.toolRouter.routeToolCall('web_browser_tabs', { action: 'list' }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
          ]);
          if (tabResult) {
            const tabText = this.extractMcpText(tabResult as { success: boolean; content?: unknown });
            if (tabText) {
              const tabCount = tabText.split('\n').filter((l) => l.trim().length > 0).length;
              browserLine += `, ${tabCount} tab${tabCount !== 1 ? 's' : ''}`;
            }
          }
        } catch {
          // Tab info unavailable — show instance only
        }
        output += `\n${browserLine}`;
      } else {
        output += '\nBrowser: offline';
      }
    }

    // Summary
    output += `\n\nTools: ${toolCount} | Sessions: ${status.sessions.activeSessions} active`;
    if (status.security.blockedCount > 0) {
      output += ` | Blocked: ${status.security.blockedCount}`;
    }

    return output;
  }

  // ─── /status summary ───────────────────────────────────────

  private async handleStatusSummary(): Promise<string> {
    const client = this.orchestrator.getThinkerClient();
    if (!client) return 'Thinker is unavailable — cannot generate summary.';

    const summaryConfig = getConfig();
    const summaryJobsConfig = summaryConfig.jobs ?? { inngestUrl: 'http://localhost:8288', port: 3000 };

    // Gather all data in parallel
    const [
      statusData,
      logIssues,
      securityResult,
      memoryStatsResult,
      fileAuditResult,
      cronJobs,
      cronSkillsResult,
      backgroundTasks,
      inngestServerUp,
      inngestEndpointUp,
    ] = await Promise.all([
      Promise.resolve(this.orchestrator.getStatus()),
      this.parseRecentLogIssues(),
      this.orchestrator.callGuardianTool('get_scan_log', { limit: 20, threats_only: true }).catch(() => null),
      this.toolRouter.routeToolCall('memory_get_memory_stats', { agent_id: 'annabelle' }).catch(() => null),
      this.toolRouter.routeToolCall('filer_get_audit_log', { limit: 20 }).catch(() => null),
      new JobStorage().listJobs().catch(() => []),
      this.toolRouter.routeToolCall('memory_list_skills', { agent_id: 'thinker', enabled: true, trigger_type: 'cron' }).catch(() => null),
      new JobStorage().listTasks().catch(() => []),
      this.checkHealth(summaryJobsConfig.inngestUrl),
      this.checkHealth(`http://localhost:${summaryJobsConfig.port}/health`),
    ]);

    // Build data bundle
    let bundle = '';

    // --- System status ---
    const uptime = this.formatUptime(statusData.uptime);
    const state = statusData.ready ? 'Ready' : 'Initializing';
    bundle += `=== SYSTEM STATUS ===\nUptime: ${uptime} | Status: ${state}\n`;

    bundle += 'MCP Services: ';
    const mcpParts: string[] = [];
    for (const [name, info] of Object.entries(statusData.mcpServers)) {
      mcpParts.push(`${name}: ${info.available ? 'up' : 'DOWN'}`);
    }
    bundle += mcpParts.join(', ') + '\n';

    bundle += 'Agents: ';
    if (statusData.agents.length === 0) {
      bundle += '(none)\n';
    } else {
      const agentParts: string[] = [];
      for (const agent of statusData.agents) {
        let agentState = agent.available ? 'up' : 'DOWN';
        if (agent.paused) agentState = `PAUSED (${agent.pauseReason || 'unknown'})`;
        agentParts.push(`${agent.agentId}: ${agentState} (port ${agent.port}, ${agent.restartCount} restarts)`);
      }
      bundle += agentParts.join(', ') + '\n';
    }

    const toolCount = this.orchestrator.getAvailableTools().length;
    bundle += `Tools: ${toolCount} | Sessions: ${statusData.sessions.activeSessions} active | Blocked: ${statusData.security.blockedCount}\n`;

    const summaryHaltManager = this.orchestrator.getHaltManager();
    const summaryInngestHalted = summaryHaltManager.isTargetHalted('inngest');
    bundle += `Inngest: ${summaryInngestHalted ? 'halted' : 'active'} | Server: ${inngestServerUp ? 'up' : 'DOWN'} | Endpoint: ${inngestEndpointUp ? 'up' : 'DOWN'}\n`;

    // --- Cron jobs ---
    bundle += '\n=== CRON JOBS ===\n';
    const enabledCronJobs = cronJobs.filter((j: JobDefinition) => j.enabled && j.type === 'cron');
    if (enabledCronJobs.length === 0) {
      bundle += '(none)\n';
    } else {
      for (const job of enabledCronJobs) {
        const lastRun = job.lastRunAt ? this.formatTimeAgo(new Date(job.lastRunAt)) : 'never';
        bundle += `- ${job.name} (${job.cronExpression}) — last run: ${lastRun}\n`;
      }
    }

    // --- Cron skills ---
    bundle += '\n=== CRON SKILLS ===\n';
    if (cronSkillsResult?.success) {
      const skillsData = this.extractData<{ skills: Array<{ name: string; trigger_config?: { schedule?: string; interval_minutes?: number }; last_run_status?: string | null; last_run_at?: string | null }> }>(cronSkillsResult);
      const skills = skillsData?.skills ?? [];
      if (skills.length === 0) {
        bundle += '(none)\n';
      } else {
        for (const skill of skills) {
          const schedule = skill.trigger_config?.schedule ?? `every ${skill.trigger_config?.interval_minutes}m`;
          const status = skill.last_run_status ?? 'never run';
          const lastRun = skill.last_run_at ? this.formatTimeAgo(new Date(skill.last_run_at)) : 'never';
          bundle += `- ${skill.name} [${schedule}] — ${status} (${lastRun})\n`;
        }
      }
    } else {
      bundle += '(unavailable)\n';
    }

    // --- Security ---
    bundle += '\n=== SECURITY ===\n';
    bundle += `Guardian: ${guardianConfig.enabled ? 'enabled' : 'disabled'} | Fail mode: ${guardianConfig.failMode}\n`;
    if (securityResult?.success) {
      const scanData = this.extractData<ScanLogResult>(securityResult);
      const threats = scanData?.scans ?? [];
      if (threats.length === 0) {
        bundle += 'Recent threats: none\n';
      } else {
        bundle += `Recent threats: ${threats.length}\n`;
        for (const scan of threats.slice(0, 10)) {
          const ts = this.formatShortTimestamp(scan.timestamp);
          const info = this.extractThreatInfo(scan);
          bundle += `  [${ts}] ${scan.source} — ${info.type}\n`;
        }
      }
    } else {
      bundle += 'Recent threats: (unavailable)\n';
    }

    // --- Log issues ---
    bundle += '\n=== RECENT LOGS (WARN/ERROR) ===\n';
    if (logIssues.length === 0) {
      bundle += 'No recent warnings or errors.\n';
    } else {
      logIssues.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      const recentLogs = logIssues.slice(0, 20);
      for (const entry of recentLogs) {
        const ts = this.formatShortTimestamp(entry.timestamp.toISOString());
        const msg = entry.message.length > 100 ? entry.message.slice(0, 100) + '...' : entry.message;
        bundle += `[${ts}] ${entry.service} [${entry.level}]: ${msg}\n`;
      }
      if (logIssues.length > 20) {
        bundle += `... and ${logIssues.length - 20} more\n`;
      }
    }

    // --- Memory stats ---
    bundle += '\n=== MEMORY ===\n';
    if (memoryStatsResult?.success) {
      const stats = this.extractData<{ fact_count?: number; conversation_count?: number; database_size_mb?: number }>(memoryStatsResult);
      if (stats) {
        bundle += `Facts: ${stats.fact_count ?? '?'} | Conversations: ${stats.conversation_count ?? '?'} | DB: ${stats.database_size_mb?.toFixed(1) ?? '?'} MB\n`;
      } else {
        bundle += '(no data)\n';
      }
    } else {
      bundle += '(unavailable)\n';
    }

    // --- File operations ---
    bundle += '\n=== FILE OPERATIONS (recent) ===\n';
    if (fileAuditResult?.success) {
      const auditData = this.extractData<{ entries: Array<{ timestamp: string; operation: string; path: string; success: boolean; error?: string }> }>(fileAuditResult);
      const entries = auditData?.entries ?? [];
      if (entries.length === 0) {
        bundle += '(none)\n';
      } else {
        for (const entry of entries) {
          const ts = this.formatShortTimestamp(entry.timestamp);
          const status = entry.success ? 'ok' : `FAIL: ${entry.error ?? 'unknown'}`;
          bundle += `[${ts}] ${entry.operation} ${entry.path} (${status})\n`;
        }
      }
    } else {
      bundle += '(unavailable)\n';
    }

    // --- Background tasks ---
    bundle += '\n=== BACKGROUND TASKS ===\n';
    if (backgroundTasks.length === 0) {
      bundle += '(none)\n';
    } else {
      const recentTasks = backgroundTasks
        .sort((a: TaskDefinition, b: TaskDefinition) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10);
      for (const task of recentTasks) {
        const ts = this.formatShortTimestamp(task.createdAt);
        const dur = task.duration ? ` (${this.formatDuration(task.duration)})` : '';
        const err = task.status === 'failed' && task.error ? ` — ${task.error.slice(0, 80)}` : '';
        bundle += `[${ts}] ${task.name} — ${task.status}${dur}${err}\n`;
      }
    }

    // Send to Thinker for analysis
    const instructions = `You are performing a system health audit. Below is a snapshot of all system data gathered just now.

${bundle}
---
Analyze this data and produce a concise Telegram-friendly summary:
1. First: briefly confirm what is running and healthy (one or two lines)
2. Then: list any anomalies — errors, failed cron jobs/skills, failed background tasks, Inngest DOWN, security threats, unusual patterns, DOWN services
   - IMPORTANT: every anomaly MUST include its date/time in brackets, e.g. [02/07 23:58]
   - Include the source/service and a brief description
3. If there are no anomalies, no new security threats, and no errors, end with: "No anomalies detected."
Keep it concise. No markdown formatting — plain text only.`;

    const result = await client.executeSkill(instructions, 1, true);

    if (!result.success) {
      return `Summary failed: ${result.error ?? 'unknown error'}`;
    }

    return result.response ?? 'Summary produced no output.';
  }

  // ─── /kill & /resume ─────────────────────────────────────

  private async handleKill(args: string): Promise<string> {
    const target = args.trim().toLowerCase();
    if (!target) {
      return 'Usage: /kill all | thinker | telegram | inngest';
    }

    const haltManager = this.orchestrator.getHaltManager();
    const agentManager = this.orchestrator.getAgentManager();
    const results: string[] = [];

    const validTargets = ['all', 'thinker', 'telegram', 'inngest'];
    if (!validTargets.includes(target)) {
      return `Unknown target "${target}". Valid targets: ${validTargets.join(', ')}`;
    }

    if (target === 'all' || target === 'thinker') {
      if (agentManager) {
        const agents = agentManager.getStatus();
        let paused = 0;
        for (const agent of agents) {
          if (!agent.paused) {
            agentManager.markPaused(agent.agentId, 'manual kill');
            paused++;
          }
        }
        results.push(`Thinker: ${paused} agent(s) paused`);
      } else {
        results.push('Thinker: no agent manager (single-agent mode)');
      }
      if (target !== 'all') haltManager.addTarget('thinker', 'manual kill');
    }

    if (target === 'all' || target === 'telegram') {
      const manager = this.orchestrator.getChannelManager();
      if (manager) {
        this.orchestrator.stopChannelPolling();
        results.push('Channels: polling stopped');
      } else {
        results.push('Channels: polling was not running');
      }
      if (target !== 'all') haltManager.addTarget('telegram', 'manual kill');
    }

    if (target === 'all' || target === 'inngest') {
      haltManager.addTarget('inngest', 'manual kill');
      results.push('Inngest: halted (functions will bail at entry)');
    }

    if (target === 'all') {
      haltManager.halt('manual kill', ['thinker', 'telegram', 'inngest']);
    }

    const header = target === 'all' ? 'All services killed.' : `${target.charAt(0).toUpperCase() + target.slice(1)} killed.`;
    const status = await this.handleStatus('');
    return `${header}\n${results.join('\n')}\n\n${status}`;
  }

  private async handleResume(args: string): Promise<string> {
    const target = args.trim().toLowerCase();
    if (!target) {
      return 'Usage: /resume all | thinker | telegram | inngest';
    }

    const haltManager = this.orchestrator.getHaltManager();
    const agentManager = this.orchestrator.getAgentManager();
    const results: string[] = [];

    const validTargets = ['all', 'thinker', 'telegram', 'inngest'];
    if (!validTargets.includes(target)) {
      return `Unknown target "${target}". Valid targets: ${validTargets.join(', ')}`;
    }

    if (target === 'all' || target === 'thinker') {
      if (agentManager) {
        const agents = agentManager.getStatus();
        let resumed = 0;
        for (const agent of agents) {
          if (agent.paused) {
            const result = await agentManager.resumeAgent(agent.agentId, true);
            if (result.success) resumed++;
          }
        }
        results.push(`Thinker: ${resumed} agent(s) resumed`);
      } else {
        results.push('Thinker: no agent manager (single-agent mode)');
      }
      haltManager.removeTarget('thinker');
    }

    if (target === 'all' || target === 'telegram') {
      const manager = this.orchestrator.getChannelManager();
      if (!manager) {
        await this.orchestrator.restartChannelPolling();
        results.push('Channels: polling restarted');
      } else {
        results.push('Channels: polling was already running');
      }
      haltManager.removeTarget('telegram');
    }

    if (target === 'all' || target === 'inngest') {
      haltManager.removeTarget('inngest');
      results.push('Inngest: resumed (functions will execute normally)');
    }

    if (target === 'all') {
      haltManager.resumeAll();
    }

    const header = target === 'all' ? 'All services resumed.' : `${target.charAt(0).toUpperCase() + target.slice(1)} resumed.`;
    const status = await this.handleStatus('');
    return `${header}\n${results.join('\n')}\n\n${status}`;
  }

  // ─── /cron ───────────────────────────────────────────────

  private async handleCron(): Promise<string> {
    const config = getConfig();
    const jobsConfig = config.jobs ?? { inngestUrl: 'http://localhost:8288', port: 3000 };
    const inngestUrl = jobsConfig.inngestUrl;
    const endpointUrl = `http://localhost:${jobsConfig.port}/health`;
    const haltManager = this.orchestrator.getHaltManager();
    const inngestHalted = haltManager.isTargetHalted('inngest');

    // Gather all data in parallel
    const [serverUp, endpointUp, cronJobs, tasks, skillsResult] = await Promise.all([
      this.checkHealth(inngestUrl),
      this.checkHealth(endpointUrl),
      new JobStorage().listJobs().catch(() => []),
      new JobStorage().listTasks().catch(() => []),
      this.toolRouter.routeToolCall('memory_list_skills', {
        agent_id: 'thinker', enabled: true, trigger_type: 'cron',
      }).catch(() => null),
    ]);

    // Header
    const inngestState = inngestHalted ? 'halted' : 'active';
    let output = `Cron Status\nInngest: ${inngestState} | Server: ${serverUp ? 'up' : 'DOWN'} | Endpoint: ${endpointUp ? 'up' : 'DOWN'}\n`;

    // --- Jobs ---
    const crons = cronJobs.filter((j: JobDefinition) => j.type === 'cron');
    const enabledCount = crons.filter((j: JobDefinition) => j.enabled).length;
    const disabledCount = crons.length - enabledCount;
    const jobsSummary = [
      enabledCount > 0 ? `${enabledCount} enabled` : null,
      disabledCount > 0 ? `${disabledCount} disabled` : null,
    ].filter(Boolean).join(', ');

    output += `\nJobs (${jobsSummary || 'none'}):\n`;
    const enabledCrons = crons.filter((j: JobDefinition) => j.enabled);
    if (enabledCrons.length === 0) {
      output += '  (none)\n';
    } else {
      for (const job of enabledCrons) {
        const name = job.name.slice(0, 20).padEnd(20);
        const expr = (job.cronExpression ?? '').padEnd(14);
        const tz = (job.timezone ?? SYSTEM_TIMEZONE).padEnd(16);
        const lastRun = job.lastRunAt ? this.formatTimeAgo(new Date(job.lastRunAt)).padEnd(10) : 'never'.padEnd(10);
        const nextRun = this.formatNextCronRun(job.cronExpression, job.timezone);
        output += `  ${name} ${expr} ${tz} ${lastRun} ${nextRun}\n`;
      }
    }

    // --- Skills ---
    const skills = this.parseCronSkills(skillsResult);
    const skillCount = skills.length;
    output += `\nSkills (${skillCount > 0 ? `${skillCount} enabled` : 'none'}):\n`;
    if (skills.length === 0) {
      output += '  (none)\n';
    } else {
      output += '  ID   | Name                 | Schedule              | Last Run   | Status\n';
      output += '  -----+----------------------+-----------------------+------------+-----------\n';
      for (const skill of skills) {
        const id = String(skill.id).padEnd(4);
        const name = skill.name.slice(0, 20).padEnd(20);
        const schedule = this.formatHumanSchedule(skill.schedule, skill.timezone).slice(0, 21).padEnd(21);
        const lastRun = (skill.lastRunAt ? this.formatTimeAgo(new Date(skill.lastRunAt)) : 'never').padEnd(10);
        const status = skill.lastStatus === 'failed' || skill.lastStatus === 'error'
          ? 'error'
          : (skill.lastStatus ?? '-');
        output += `  ${id} | ${name} | ${schedule} | ${lastRun} | ${status}\n`;
      }
    }

    // --- Tasks ---
    const sorted = tasks.sort((a: TaskDefinition, b: TaskDefinition) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ).slice(0, 10);

    const running = tasks.filter((t: TaskDefinition) => t.status === 'running').length;
    const completed = tasks.filter((t: TaskDefinition) => t.status === 'completed').length;
    const failed = tasks.filter((t: TaskDefinition) => t.status === 'failed').length;
    const queued = tasks.filter((t: TaskDefinition) => t.status === 'queued').length;
    const taskParts = [
      running > 0 ? `${running} running` : null,
      queued > 0 ? `${queued} queued` : null,
      completed > 0 ? `${completed} completed` : null,
      failed > 0 ? `${failed} failed` : null,
    ].filter(Boolean).join(', ');

    output += `\nTasks (${taskParts || 'none'}):\n`;
    if (sorted.length === 0) {
      output += '  (none)\n';
    } else {
      for (const task of sorted) {
        const name = task.name.slice(0, 20).padEnd(20);
        const ago = this.formatTimeAgo(new Date(task.createdAt));
        const isFailed = task.status === 'failed';
        const statusLabel = isFailed ? '[!] failed' : task.status;
        let detail = `${name} ${statusLabel.padEnd(12)} ${ago}`;
        if (task.status === 'completed' && task.duration) {
          detail += `    (took ${this.formatDuration(task.duration)})`;
        }
        if (isFailed && task.error) {
          const errMsg = task.error.length > 40 ? task.error.slice(0, 40) + '...' : task.error;
          detail += `    "${errMsg}"`;
        }
        output += `  ${detail}\n`;
      }
    }

    return output;
  }

  // ─── /browser ──────────────────────────────────────────────

  private async handleBrowser(): Promise<string> {
    const status = this.orchestrator.getStatus();
    const webMcp = status.mcpServers.web;

    if (!webMcp) {
      return 'Browser MCP is not installed.';
    }

    const proxyEnabled = process.env.BROWSER_PROXY_ENABLED === 'true';
    const proxyServer = process.env.BROWSER_PROXY_SERVER;
    const proxyLabel = proxyEnabled && proxyServer ? proxyServer : 'disabled';

    let output = `Browser Status\nMCP: ${webMcp.available ? 'up' : 'DOWN'} (${webMcp.type}) | Proxy: ${proxyLabel}\n`;

    if (!webMcp.available) {
      output += '\nBrowser MCP is offline — no session data available.';
      return output;
    }

    // Try to get tab listing from the browser
    try {
      const result = await this.toolRouter.routeToolCall('web_browser_tabs', { action: 'list' });
      const tabText = this.extractMcpText(result);

      if (tabText) {
        const tabLines = tabText.split('\n').filter((l) => l.trim().length > 0);
        output += `\nTabs (${tabLines.length}):\n`;
        for (const line of tabLines) {
          output += `  ${line}\n`;
        }
      } else {
        output += '\nNo active browser session';
      }
    } catch {
      output += '\nNo active browser session';
    }

    return output;
  }

  // ─── /diagnose ───────────────────────────────────────────────

  private async handleDiagnose(): Promise<string> {
    const status = this.orchestrator.getStatus();
    const ctx = {
      orchestrator: this.orchestrator,
      toolRouter: this.toolRouter,
      status,
    };

    const result = await runDiagnosticChecks(ctx);
    return formatDiagnosticOutput(result);
  }

  /**
   * Extract raw text from an MCP tool result (for tools that return plain text, not StandardResponse JSON).
   */
  private extractMcpText(result: { success: boolean; content?: unknown }): string | null {
    if (!result.success) return null;
    const mcpResponse = result.content as { content?: Array<{ type: string; text?: string }> };
    const text = mcpResponse?.content?.[0]?.text;
    return text?.trim() || null;
  }

  private async checkHealth(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  private formatNextCronRun(cronExpr?: string, timezone?: string): string {
    if (!cronExpr) return '';
    try {
      const cron = new Cron(cronExpr, { timezone: timezone ?? SYSTEM_TIMEZONE });
      const next = cron.nextRun();
      if (!next) return '';
      const hours = String(next.getHours()).padStart(2, '0');
      const minutes = String(next.getMinutes()).padStart(2, '0');
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const now = new Date();
      const isToday = next.toDateString() === now.toDateString();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow = next.toDateString() === tomorrow.toDateString();
      if (isToday) return `→ ${hours}:${minutes}`;
      if (isTomorrow) return `→ tmrw ${hours}:${minutes}`;
      return `→ ${days[next.getDay()]} ${hours}:${minutes}`;
    } catch {
      return '';
    }
  }

  private parseCronSkills(result: { success: boolean; content?: unknown; error?: string } | null): Array<{
    id: number; name: string; schedule: string; timezone?: string;
    lastRunAt?: string; lastStatus?: string;
  }> {
    if (!result?.success) return [];
    const data = this.extractData<{ skills: Array<{
      id: number;
      name: string;
      trigger_config?: { schedule?: string; interval_minutes?: number; timezone?: string };
      last_run_status?: string | null;
      last_run_at?: string | null;
    }> }>(result);
    const skills = data?.skills ?? [];
    return skills.map(s => ({
      id: s.id,
      name: s.name,
      schedule: s.trigger_config?.schedule ?? `every ${s.trigger_config?.interval_minutes ?? 1440}m`,
      timezone: s.trigger_config?.timezone,
      lastRunAt: s.last_run_at ?? undefined,
      lastStatus: s.last_run_status ?? undefined,
    }));
  }

  /**
   * Convert a cron expression into a human-readable schedule string.
   * e.g. "0 8 * * *" + "America/Detroit" → "8:00 AM daily (Detroit)"
   */
  private formatHumanSchedule(schedule: string, timezone?: string): string {
    const tzShort = timezone ? timezone.split('/').pop() ?? '' : '';

    // "every Nm" from interval_minutes
    const intervalMatch = schedule.match(/^every (\d+)m$/);
    if (intervalMatch) {
      const mins = parseInt(intervalMatch[1], 10);
      if (mins < 60) return `every ${mins} min`;
      if (mins === 60) return 'every hour';
      if (mins % 60 === 0) return `every ${mins / 60} hours`;
      return `every ${mins} min`;
    }

    const parts = schedule.split(/\s+/);
    if (parts.length !== 5) return schedule;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

    // "*/N * * * *" → every N min
    const everyMinMatch = minute.match(/^\*\/(\d+)$/);
    if (everyMinMatch && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      return `every ${everyMinMatch[1]} min`;
    }

    // "0 */N * * *" → every N hours
    if (minute === '0' && hour.startsWith('*/') && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      const h = hour.slice(2);
      return `every ${h} hours`;
    }

    // Fixed time schedules
    if (minute.match(/^\d+$/) && hour.match(/^\d+$/)) {
      const h = parseInt(hour, 10);
      const m = parseInt(minute, 10);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const timeStr = m === 0 ? `${h12}:00 ${ampm}` : `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
      const tzSuffix = tzShort ? ` (${tzShort})` : '';

      // daily
      if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
        return `${timeStr} daily${tzSuffix}`;
      }

      // specific day(s) of week
      if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const days = dayOfWeek.split(',').map(d => dayNames[parseInt(d, 10)] ?? d).join('/');
        return `${timeStr} ${days}${tzSuffix}`;
      }
    }

    // Fallback: raw cron + timezone
    return tzShort ? `${schedule} (${tzShort})` : schedule;
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  // ─── /delete ──────────────────────────────────────────────

  private async handleDelete(chatId: string, args: string): Promise<string> {
    const parsed = this.parseDeleteArgs(args);

    switch (parsed.type) {
      case 'today':
        return this.deleteByTime(chatId, this.getStartOfToday());

      case 'yesterday':
        return this.deleteByTime(chatId, this.getStartOfYesterday());

      case 'week':
        return this.deleteByTime(chatId, this.getStartOfThisWeek());

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
    | { type: 'yesterday' }
    | { type: 'week' }
    | { type: 'hours'; value: number }
    | { type: 'count'; value: number }
    | { type: 'invalid'; reason: string } {
    const trimmed = args.trim().toLowerCase();

    if (!trimmed) {
      return { type: 'invalid', reason: 'Usage: /delete today | yesterday | week | <N>h | <N>' };
    }

    if (trimmed === 'today') {
      return { type: 'today' };
    }

    if (trimmed === 'yesterday') {
      return { type: 'yesterday' };
    }

    if (trimmed === 'this week' || trimmed === 'week') {
      return { type: 'week' };
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

    return { type: 'invalid', reason: 'Usage: /delete today | yesterday | week | <N>h | <N>' };
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
    output += '  /status summary — AI health audit (logs, security, memory, cron)\n';
    output += '  /diagnose — Deep system diagnosis (22 automated checks with actionable findings)\n';
    output += '  /help — This info page (commands, tools, skills)\n';
    output += '  /delete — Delete messages (today | yesterday | week | <N>h | <N>)\n';
    output += '  /security — Guardian status & scan config\n';
    output += '  /security [N] — Last N security threats (default 10)\n';
    output += '  /logs — Log file sizes & freshness\n';
    output += '  /logs [N] — Last N warnings/errors (default 15)\n';
    output += '  /cron — Inngest status, cron jobs, skills & background tasks\n';
    output += '  /browser — Browser status (proxy, open tabs)\n';
    output += '  /kill — Kill services (all | thinker | telegram | inngest)\n';
    output += '  /resume — Resume services (all | thinker | telegram | inngest)\n';

    // MCP services + tool counts
    output += '\nMCP Services:\n';
    const mcpEntries = Object.entries(status.mcpServers);
    for (const [name, info] of mcpEntries) {
      const label = MCP_DISPLAY_NAMES[name] ?? name;
      const state = info.available ? 'up' : 'DOWN';
      const count = toolsByMcp.get(name)?.length ?? 0;
      output += `  ${label}: ${state} (${count} tools)\n`;
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
      return 'Cannot read log directory: ~/.annabelle/logs/';
    }

    if (files.length === 0) return 'No log files found.';

    let output = 'System Logs (~/.annabelle/logs/)\n\n';
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
    const allEntries = await this.parseRecentLogIssues();

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

  /** Parse WARN/ERROR entries from all service log files. */
  private async parseRecentLogIssues(): Promise<Array<{ timestamp: Date; service: string; level: string; message: string }>> {
    const allEntries: Array<{ timestamp: Date; service: string; level: string; message: string }> = [];

    for (const filename of SERVICE_LOG_FILES) {
      try {
        const content = await readFile(join(LOGS_DIR, filename), 'utf-8');
        const lines = content.split('\n');
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

    return allEntries;
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

  private getStartOfYesterday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  }

  private getStartOfThisWeek(): Date {
    const now = new Date();
    const day = now.getDay();
    // Monday = 1, Sunday = 0 → offset so Monday is start of week
    const daysBack = day === 0 ? 6 : day - 1;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack);
  }

  /**
   * Extract typed data from a ToolRouter result.
   * Same pattern as GenericChannelAdapter.extractData().
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
