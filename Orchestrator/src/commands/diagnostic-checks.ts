/**
 * Diagnostic Checks — 22 automated health checks for /diagnose and proactive health reports.
 *
 * Each check is an independent async function that returns a DiagnosticFinding
 * if something noteworthy is found, or null if everything is fine.
 */

import { readdir, stat, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { Orchestrator, OrchestratorStatus } from '../core/orchestrator.js';
import type { ToolRouter } from '../routing/tool-router.js';
import { guardianConfig } from '../config/guardian.js';
import { getConfig } from '../config/index.js';
import { JobStorage } from '../jobs/storage.js';
import type { JobDefinition, TaskDefinition } from '../jobs/types.js';
import { Cron } from 'croner';
import {
  loadBaseline,
  compareToBaseline,
  getCurrentHourCounts,
  type ErrorBaseline,
} from './error-baseline.js';

const SYSTEM_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

// ─── Types ──────────────────────────────────────────────────

export type Severity = 'critical' | 'warning' | 'info';

export interface DiagnosticFinding {
  /** Unique check identifier (e.g. "mcp-health", "ollama-connectivity"). */
  id: string;
  /** Severity level. */
  severity: Severity;
  /** Category for grouping. */
  category: string;
  /** Short summary of the finding. */
  summary: string;
  /** Actionable recommendation. */
  recommendation: string;
}

export interface DiagnosticContext {
  orchestrator: Orchestrator;
  toolRouter: ToolRouter;
  status: OrchestratorStatus;
}

export interface DiagnosticResult {
  totalChecks: number;
  findings: DiagnosticFinding[];
  duration: number;
}

// ─── Constants ──────────────────────────────────────────────

const LOGS_DIR = join(homedir(), '.annabelle', 'logs');
const DATA_DIR = join(homedir(), '.annabelle', 'data');
const DOCS_DIR = join(homedir(), '.annabelle', 'documentation');

const LOG_SIZE_WARN_BYTES = 50 * 1024 * 1024; // 50 MB
const EMBEDDING_CACHE_WARN_BYTES = 10 * 1024 * 1024; // 10 MB
const MEMORY_DB_WARN_BYTES = 50 * 1024 * 1024; // 50 MB
const SESSION_WARN_COUNT = 20;
const JOB_QUEUE_WARN_COUNT = 1000;
const AGENT_FLAP_THRESHOLD = 3;
const TRACE_STALENESS_MS = 60 * 60 * 1000; // 1 hour
const SNAPSHOT_STALENESS_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Check Registry ─────────────────────────────────────────

type CheckFn = (ctx: DiagnosticContext) => Promise<DiagnosticFinding | null>;

const checks: CheckFn[] = [
  // Services (5)
  checkMCPHealth,
  checkAgentHealth,
  checkInngestHealth,
  checkCostStatus,
  checkHaltManager,
  // Embedding & Search (3)
  checkOllamaConnectivity,
  checkEmbeddingCacheSize,
  checkMemoryDBSize,
  // Logs (3)
  checkLogFileSizes,
  checkErrorRateBaseline,
  checkTraceLogFreshness,
  // Cron & Jobs (4)
  checkStaleCronJobs,
  checkFailedCronSkills,
  checkFailedTasks,
  checkJobQueueDepth,
  // Tools (2)
  checkToolCountDrift,
  checkGuardianAvailability,
  // Data (3)
  checkDataDirectorySize,
  checkSessionCount,
  checkDocumentationFreshness,
  // Security (2)
  checkRecentThreatRate,
  checkGuardianScanFailures,
];

// ─── Runner ─────────────────────────────────────────────────

/**
 * Run all diagnostic checks in parallel and return findings.
 */
export async function runDiagnosticChecks(ctx: DiagnosticContext): Promise<DiagnosticResult> {
  const start = Date.now();

  const results = await Promise.all(
    checks.map(async (check) => {
      try {
        return await check(ctx);
      } catch {
        // Individual check failure shouldn't break the whole diagnosis
        return null;
      }
    }),
  );

  const findings = results.filter((r): r is DiagnosticFinding => r !== null);

  // Sort: critical first, then warning, then info
  const severityOrder: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    totalChecks: checks.length,
    findings,
    duration: Date.now() - start,
  };
}

/**
 * Format diagnostic results as a human-readable string for Telegram.
 */
export function formatDiagnosticOutput(result: DiagnosticResult): string {
  const { totalChecks, findings, duration } = result;

  let output = `System Diagnosis (${totalChecks} checks, ${findings.length} finding${findings.length !== 1 ? 's' : ''}, ${duration}ms)\n`;

  if (findings.length === 0) {
    output += '\nAll checks passed.';
    return output;
  }

  const severityIcon: Record<Severity, string> = {
    critical: '[!!]',
    warning: '[!]',
    info: '[i]',
  };

  for (const finding of findings) {
    const icon = severityIcon[finding.severity];
    output += `\n${icon} ${finding.category}: ${finding.summary}`;
    output += `\n    → ${finding.recommendation}`;
  }

  const passedCount = totalChecks - findings.length;
  if (passedCount > 0) {
    output += `\n\n${passedCount} other check${passedCount !== 1 ? 's' : ''} passed.`;
  }

  return output;
}

// ─── Individual Checks ──────────────────────────────────────

// --- Services ---

async function checkMCPHealth(ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  const downMcps: string[] = [];

  for (const [name, info] of Object.entries(ctx.status.mcpServers)) {
    if (!info.available) {
      downMcps.push(name);
    }
  }

  if (downMcps.length === 0) return null;

  return {
    id: 'mcp-health',
    severity: 'critical',
    category: 'Services',
    summary: `${downMcps.length} MCP(s) down: ${downMcps.join(', ')}`,
    recommendation: 'Check service logs with /logs, then restart with ./restart.sh',
  };
}

async function checkAgentHealth(ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  const issues: string[] = [];

  for (const agent of ctx.status.agents) {
    if (agent.paused) {
      issues.push(`${agent.agentId} PAUSED (${agent.pauseReason || 'unknown'})`);
    } else if (!agent.available) {
      issues.push(`${agent.agentId} DOWN`);
    } else if (agent.restartCount > AGENT_FLAP_THRESHOLD) {
      issues.push(`${agent.agentId} flapping (${agent.restartCount} restarts)`);
    }
  }

  if (issues.length === 0) return null;

  const hasCritical = issues.some((i) => i.includes('DOWN') || i.includes('PAUSED'));
  return {
    id: 'agent-health',
    severity: hasCritical ? 'critical' : 'warning',
    category: 'Services',
    summary: issues.join('; '),
    recommendation: hasCritical
      ? 'Use /resume to unpause or check agent logs'
      : 'High restart count may indicate instability — check orchestrator.log for [thinker:] entries',
  };
}

async function checkInngestHealth(ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  const config = getConfig();
  const jobsConfig = config.jobs ?? { inngestUrl: 'http://localhost:8288', port: 3000 };

  const [serverUp, endpointUp] = await Promise.all([
    checkUrl(jobsConfig.inngestUrl),
    checkUrl(`http://localhost:${jobsConfig.port}/health`),
  ]);

  if (serverUp && endpointUp) return null;

  const down: string[] = [];
  if (!serverUp) down.push('Inngest server');
  if (!endpointUp) down.push('Inngest endpoint');

  return {
    id: 'inngest-health',
    severity: 'critical',
    category: 'Services',
    summary: `${down.join(' and ')} unreachable`,
    recommendation: 'Cron jobs and background tasks are not running. Restart with ./restart.sh',
  };
}

async function checkCostStatus(ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  const agentManager = ctx.orchestrator.getAgentManager();
  if (!agentManager) return null;

  for (const agent of ctx.status.agents) {
    if (agent.paused && agent.pauseReason?.includes('token')) {
      return {
        id: 'cost-status',
        severity: 'critical',
        category: 'Services',
        summary: `Agent "${agent.agentId}" paused: ${agent.pauseReason}`,
        recommendation: 'Use /resume thinker to resume, or wait for the cost window to reset',
      };
    }
  }

  return null;
}

async function checkHaltManager(ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  const haltManager = ctx.orchestrator.getHaltManager();
  const halted: string[] = [];

  for (const target of ['thinker', 'telegram', 'inngest'] as const) {
    if (haltManager.isTargetHalted(target)) {
      halted.push(target);
    }
  }

  if (halted.length === 0) return null;

  return {
    id: 'halt-manager',
    severity: 'warning',
    category: 'Services',
    summary: `Halted targets: ${halted.join(', ')}`,
    recommendation: 'Use /resume to restore service',
  };
}

// --- Embedding & Search ---

async function checkOllamaConnectivity(_ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const up = await checkUrl(`${ollamaUrl}/api/tags`);

  if (up) return null;

  return {
    id: 'ollama-connectivity',
    severity: 'warning',
    category: 'Embeddings',
    summary: 'Ollama is unreachable at ' + ollamaUrl,
    recommendation: 'Vector search degraded to text-only. Start Ollama or check OLLAMA_URL',
  };
}

async function checkEmbeddingCacheSize(_ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  const cachePath = join(DATA_DIR, 'embedding-cache.json');
  try {
    const s = await stat(cachePath);
    if (s.size < EMBEDDING_CACHE_WARN_BYTES) return null;

    return {
      id: 'embedding-cache-size',
      severity: 'info',
      category: 'Embeddings',
      summary: `embedding-cache.json is ${formatSize(s.size)} (threshold: ${formatSize(EMBEDDING_CACHE_WARN_BYTES)})`,
      recommendation: 'Consider clearing stale embedding entries or running backfill_embeddings',
    };
  } catch {
    return null; // File doesn't exist — fine
  }
}

async function checkMemoryDBSize(_ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  const dbPath = join(DATA_DIR, 'memory.db');
  try {
    const s = await stat(dbPath);
    if (s.size < MEMORY_DB_WARN_BYTES) return null;

    return {
      id: 'memory-db-size',
      severity: 'info',
      category: 'Embeddings',
      summary: `memory.db is ${formatSize(s.size)} (threshold: ${formatSize(MEMORY_DB_WARN_BYTES)})`,
      recommendation: 'Run memory synthesis to consolidate facts, or export and clean old data',
    };
  } catch {
    return null;
  }
}

// --- Logs ---

async function checkLogFileSizes(_ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  try {
    const entries = await readdir(LOGS_DIR);
    const large: string[] = [];

    for (const name of entries) {
      if (name.startsWith('build-')) continue;
      try {
        const s = await stat(join(LOGS_DIR, name));
        if (s.size >= LOG_SIZE_WARN_BYTES) {
          large.push(`${name} (${formatSize(s.size)})`);
        }
      } catch {
        // skip
      }
    }

    if (large.length === 0) return null;

    return {
      id: 'log-file-sizes',
      severity: 'warning',
      category: 'Logs',
      summary: `Large log files: ${large.join(', ')}`,
      recommendation: 'Consider rotating or truncating logs to free disk space',
    };
  } catch {
    return null;
  }
}

async function checkErrorRateBaseline(_ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  const baseline = loadBaseline();
  const currentCounts = await getCurrentHourCounts();

  const anomalies: string[] = [];

  for (const [service, counts] of currentCounts) {
    const comparison = compareToBaseline(baseline, service, counts.errors, counts.warnings);
    if (comparison.isAnomaly) {
      if (comparison.errorMultiplier >= 3 && counts.errors >= 3) {
        anomalies.push(
          `${service}: ${counts.errors} errors this hour (${comparison.errorMultiplier.toFixed(1)}x baseline)`,
        );
      } else if (comparison.warningMultiplier >= 3 && counts.warnings >= 5) {
        anomalies.push(
          `${service}: ${counts.warnings} warnings this hour (${comparison.warningMultiplier.toFixed(1)}x baseline)`,
        );
      }
    }
  }

  if (anomalies.length === 0) return null;

  return {
    id: 'error-rate-baseline',
    severity: 'warning',
    category: 'Logs',
    summary: anomalies.join('; '),
    recommendation: 'Check /logs for details on the elevated error rate',
  };
}

async function checkTraceLogFreshness(_ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  const tracePath = join(LOGS_DIR, 'traces.jsonl');
  try {
    const s = await stat(tracePath);
    const age = Date.now() - s.mtime.getTime();

    if (age < TRACE_STALENESS_MS) return null;

    const hoursAgo = Math.round(age / (60 * 60 * 1000));
    return {
      id: 'trace-log-freshness',
      severity: 'warning',
      category: 'Logs',
      summary: `Trace log hasn't been written to in ${hoursAgo}h`,
      recommendation: 'Agent may be idle or dead — check agent status with /status',
    };
  } catch {
    return null; // File doesn't exist — agent may not have started yet
  }
}

// --- Cron & Jobs ---

async function checkStaleCronJobs(_ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  try {
    const jobs = await new JobStorage().listJobs();
    const enabledCrons = jobs.filter(
      (j: JobDefinition) => j.type === 'cron' && j.enabled && j.cronExpression,
    );

    const stale: string[] = [];
    const now = Date.now();

    for (const job of enabledCrons) {
      if (!job.lastRunAt) {
        // Never ran — check if it should have by now
        const created = new Date(job.createdAt).getTime();
        if (now - created > 2 * 60 * 60 * 1000) {
          stale.push(`"${job.name}" (never ran)`);
        }
        continue;
      }

      // Calculate expected interval from cron expression
      try {
        const cron = new Cron(job.cronExpression!, { timezone: job.timezone || SYSTEM_TIMEZONE });
        const lastRun = new Date(job.lastRunAt);
        const nextExpected = cron.nextRun(lastRun);
        if (nextExpected) {
          const expectedInterval = nextExpected.getTime() - lastRun.getTime();
          const timeSinceLastRun = now - lastRun.getTime();
          if (timeSinceLastRun > expectedInterval * 2) {
            const hoursLate = Math.round(timeSinceLastRun / (60 * 60 * 1000));
            stale.push(`"${job.name}" (${hoursLate}h since last run)`);
          }
        }
      } catch {
        // Invalid cron — skip
      }
    }

    if (stale.length === 0) return null;

    return {
      id: 'stale-cron-jobs',
      severity: 'warning',
      category: 'Cron',
      summary: `Stale cron jobs: ${stale.join(', ')}`,
      recommendation: 'Check Inngest status with /cron, or manually trigger the job',
    };
  } catch {
    return null;
  }
}

async function checkFailedCronSkills(ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  try {
    const result = await ctx.toolRouter.routeToolCall('memory_list_skills', {
      agent_id: 'thinker',
      enabled: true,
      trigger_type: 'cron',
    });

    if (!result.success) return null;

    const mcpResponse = result.content as { content?: Array<{ type: string; text?: string }> };
    const text = mcpResponse?.content?.[0]?.text;
    if (!text) return null;

    const data = JSON.parse(text);
    const skills = (data?.data?.skills || data?.skills || []) as Array<{
      name: string;
      last_run_status?: string | null;
    }>;

    const failed = skills.filter((s) => s.last_run_status === 'error');
    if (failed.length === 0) return null;

    return {
      id: 'failed-cron-skills',
      severity: 'warning',
      category: 'Cron',
      summary: `${failed.length} cron skill(s) in error state: ${failed.map((s) => s.name).join(', ')}`,
      recommendation: 'Skills are in cooldown after failure. Check logs for the root cause',
    };
  } catch {
    return null;
  }
}

async function checkFailedTasks(_ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  try {
    const tasks = await new JobStorage().listTasks();
    const recentFailed = tasks
      .filter((t: TaskDefinition) => t.status === 'failed')
      .filter((t: TaskDefinition) => {
        const age = Date.now() - new Date(t.completedAt || t.createdAt).getTime();
        return age < 6 * 60 * 60 * 1000; // Last 6 hours
      });

    if (recentFailed.length === 0) return null;

    const names = recentFailed
      .slice(0, 3)
      .map((t: TaskDefinition) => `"${t.name}"`)
      .join(', ');
    const more = recentFailed.length > 3 ? ` and ${recentFailed.length - 3} more` : '';

    return {
      id: 'failed-tasks',
      severity: 'warning',
      category: 'Cron',
      summary: `${recentFailed.length} failed task(s) in last 6h: ${names}${more}`,
      recommendation: 'Check task details in ~/.annabelle/data/tasks/',
    };
  } catch {
    return null;
  }
}

async function checkJobQueueDepth(_ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  const jobsDir = join(DATA_DIR, 'jobs');
  try {
    const entries = await readdir(jobsDir);
    if (entries.length < JOB_QUEUE_WARN_COUNT) return null;

    return {
      id: 'job-queue-depth',
      severity: 'info',
      category: 'Cron',
      summary: `Job queue has ${entries.length} entries (threshold: ${JOB_QUEUE_WARN_COUNT})`,
      recommendation: 'Consider cleaning up old completed jobs to reduce disk usage',
    };
  } catch {
    return null;
  }
}

// --- Tools ---

async function checkToolCountDrift(ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  const snapshotPath = join(DOCS_DIR, 'system-snapshot.md');
  try {
    const content = await readFile(snapshotPath, 'utf-8');
    const match = content.match(/Total tools:\s*(\d+)/);
    if (!match) return null;

    const snapshotCount = parseInt(match[1], 10);
    const currentCount = ctx.orchestrator.getAvailableTools().length;
    const diff = currentCount - snapshotCount;

    if (Math.abs(diff) < 3) return null;

    const direction = diff > 0 ? 'more' : 'fewer';
    return {
      id: 'tool-count-drift',
      severity: 'warning',
      category: 'Tools',
      summary: `Tool count changed: ${currentCount} now vs ${snapshotCount} at last snapshot (${Math.abs(diff)} ${direction})`,
      recommendation: diff < 0
        ? 'An MCP may have dropped tools — check MCP health'
        : 'New tools detected — regenerate system snapshot',
    };
  } catch {
    return null; // Snapshot doesn't exist — skip
  }
}

async function checkGuardianAvailability(ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  if (!guardianConfig.enabled) return null;

  const guardian = ctx.status.mcpServers.guardian;
  if (guardian?.available) return null;

  const failMode = guardianConfig.failMode;
  return {
    id: 'guardian-availability',
    severity: failMode === 'closed' ? 'critical' : 'warning',
    category: 'Tools',
    summary: `Guardian MCP is down (fail mode: ${failMode})`,
    recommendation: failMode === 'closed'
      ? 'All tool calls may be blocked — restart Guardian ASAP'
      : 'Tool calls proceeding without security scanning',
  };
}

// --- Data ---

async function checkDataDirectorySize(_ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  try {
    let totalSize = 0;
    const entries = await readdir(DATA_DIR);

    for (const name of entries) {
      try {
        const s = await stat(join(DATA_DIR, name));
        if (s.isFile()) totalSize += s.size;
      } catch {
        // skip
      }
    }

    // Warn above 100MB for data files (excluding subdirectories)
    if (totalSize < 100 * 1024 * 1024) return null;

    return {
      id: 'data-dir-size',
      severity: 'info',
      category: 'Data',
      summary: `Data directory files total ${formatSize(totalSize)}`,
      recommendation: 'Consider cleaning up old data or running memory synthesis',
    };
  } catch {
    return null;
  }
}

async function checkSessionCount(ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  const { activeSessions } = ctx.status.sessions;
  if (activeSessions < SESSION_WARN_COUNT) return null;

  return {
    id: 'session-count',
    severity: 'warning',
    category: 'Data',
    summary: `${activeSessions} active sessions (threshold: ${SESSION_WARN_COUNT})`,
    recommendation: 'Possible session leak — check for unclosed conversations',
  };
}

async function checkDocumentationFreshness(_ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  const snapshotPath = join(DOCS_DIR, 'system-snapshot.md');
  try {
    const s = await stat(snapshotPath);
    const age = Date.now() - s.mtime.getTime();

    if (age < SNAPSHOT_STALENESS_MS) return null;

    const daysAgo = Math.round(age / (24 * 60 * 60 * 1000));
    return {
      id: 'doc-freshness',
      severity: 'info',
      category: 'Data',
      summary: `System snapshot is ${daysAgo} day(s) old`,
      recommendation: 'Regenerate with: npx tsx _scripts/generate-system-snapshot.ts',
    };
  } catch {
    return {
      id: 'doc-freshness',
      severity: 'info',
      category: 'Data',
      summary: 'System snapshot not found',
      recommendation: 'Generate with: npx tsx _scripts/generate-system-snapshot.ts',
    };
  }
}

// --- Security ---

async function checkRecentThreatRate(ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  if (!guardianConfig.enabled) return null;

  try {
    const result = await ctx.orchestrator.callGuardianTool('get_scan_log', {
      limit: 200,
    });
    if (!result?.success) return null;

    const mcpResponse = result.content as { content?: Array<{ type: string; text?: string }> };
    const text = mcpResponse?.content?.[0]?.text;
    if (!text) return null;

    const data = JSON.parse(text);
    const scanData = data?.data || data;
    const scans = (scanData?.scans || []) as Array<{ timestamp: string; safe: boolean }>;

    // Count threats in last hour
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentScans = scans.filter((s) => new Date(s.timestamp).getTime() > oneHourAgo);
    const recentThreats = recentScans.filter((s) => !s.safe);

    if (recentThreats.length < 3) return null;

    return {
      id: 'threat-rate',
      severity: 'warning',
      category: 'Security',
      summary: `${recentThreats.length} threats in the last hour (${recentScans.length} total scans)`,
      recommendation: 'Check /security for threat details',
    };
  } catch {
    return null;
  }
}

async function checkGuardianScanFailures(ctx: DiagnosticContext): Promise<DiagnosticFinding | null> {
  if (!guardianConfig.enabled) return null;

  try {
    const result = await ctx.orchestrator.callGuardianTool('get_scan_log', {
      limit: 50,
    });
    if (!result?.success) return null;

    const mcpResponse = result.content as { content?: Array<{ type: string; text?: string }> };
    const text = mcpResponse?.content?.[0]?.text;
    if (!text) return null;

    const data = JSON.parse(text);
    const scanData = data?.data || data;
    const scans = (scanData?.scans || []) as Array<{
      timestamp: string;
      safe: boolean;
      confidence?: number;
    }>;

    // Low confidence scans may indicate Guardian model issues
    const lowConfidence = scans.filter(
      (s) => s.confidence !== undefined && s.confidence < 0.5,
    );

    if (lowConfidence.length < 5) return null;

    return {
      id: 'guardian-scan-quality',
      severity: 'info',
      category: 'Security',
      summary: `${lowConfidence.length} low-confidence Guardian scans (< 0.5) in recent history`,
      recommendation: 'Guardian model may need attention — check Ollama model status',
    };
  } catch {
    return null;
  }
}

// ─── Helpers ────────────────────────────────────────────────

async function checkUrl(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
