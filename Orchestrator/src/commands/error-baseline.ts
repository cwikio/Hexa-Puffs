/**
 * Error Rate Baseline — Tracks hourly error/warning counts per service.
 *
 * Stores rolling averages in ~/.annabelle/data/error-baseline.json so
 * /diagnose can compare "current hour" vs "what's normal" for each service.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readFile } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { logger as rootLogger } from '@mcp/shared/Utils/logger.js';

const logger = rootLogger.child('error-baseline');

const BASELINE_PATH = join(homedir(), '.annabelle', 'data', 'error-baseline.json');
const LOGS_DIR = join(homedir(), '.annabelle', 'logs');

/** Number of hours to keep in the rolling window. */
const ROLLING_HOURS = 168; // 7 days

/** Service log files to scan (same list as slash-commands.ts).
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

// ─── Types ──────────────────────────────────────────────────

export interface ServiceBaseline {
  /** Rolling average errors per hour (over ROLLING_HOURS window). */
  avgErrorsPerHour: number;
  /** Rolling average warnings per hour. */
  avgWarningsPerHour: number;
  /** Raw hourly error counts, indexed 0..23 for each hour of day. */
  hourlyErrors: number[];
  /** Raw hourly warning counts, indexed 0..23. */
  hourlyWarnings: number[];
  /** ISO date-hour of last update, e.g. "2026-02-12T14". */
  lastUpdatedHour: string;
  /** Total error samples contributing to the average. */
  totalErrorSamples: number;
  /** Total warning samples contributing to the average. */
  totalWarningSamples: number;
}

export interface ErrorBaseline {
  /** ISO timestamp of last update. */
  updated: string;
  /** Per-service baselines. */
  services: Record<string, ServiceBaseline>;
}

export interface BaselineComparison {
  service: string;
  currentErrors: number;
  currentWarnings: number;
  avgErrors: number;
  avgWarnings: number;
  errorMultiplier: number;
  warningMultiplier: number;
  isAnomaly: boolean;
}

// ─── Load / Save ────────────────────────────────────────────

export function loadBaseline(): ErrorBaseline {
  if (!existsSync(BASELINE_PATH)) {
    return { updated: new Date().toISOString(), services: {} };
  }

  try {
    const raw = readFileSync(BASELINE_PATH, 'utf-8');
    return JSON.parse(raw) as ErrorBaseline;
  } catch {
    logger.warn('Failed to parse error baseline, starting fresh');
    return { updated: new Date().toISOString(), services: {} };
  }
}

export function saveBaseline(baseline: ErrorBaseline): void {
  try {
    const dir = join(homedir(), '.annabelle', 'data');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2), 'utf-8');
  } catch (error) {
    logger.error('Failed to save error baseline', { error });
  }
}

// ─── Log Parsing ────────────────────────────────────────────

interface LogEntry {
  timestamp: Date;
  service: string;
  level: 'WARN' | 'ERROR';
}

const LOG_LINE_REGEX = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\]\s+\[(WARN|ERROR)\]/;

/**
 * Parse all service log files and count WARN/ERROR entries per service per hour.
 * Returns a map: service → Map<hourKey, { errors, warnings }>.
 */
async function parseLogCounts(): Promise<Map<string, Map<string, { errors: number; warnings: number }>>> {
  const result = new Map<string, Map<string, { errors: number; warnings: number }>>();

  for (const filename of SERVICE_LOG_FILES) {
    const service = basename(filename, '.log');
    const hourMap = new Map<string, { errors: number; warnings: number }>();

    try {
      const content = await new Promise<string>((resolve, reject) => {
        readFile(join(LOGS_DIR, filename), 'utf-8', (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      });

      const lines = content.split('\n');
      // Process all lines (not just recent) for baseline accuracy
      for (const line of lines) {
        const match = line.match(LOG_LINE_REGEX);
        if (!match) continue;

        const ts = new Date(match[1]);
        const level = match[2] as 'WARN' | 'ERROR';
        const hourKey = toHourKey(ts);

        let counts = hourMap.get(hourKey);
        if (!counts) {
          counts = { errors: 0, warnings: 0 };
          hourMap.set(hourKey, counts);
        }

        if (level === 'ERROR') counts.errors++;
        else counts.warnings++;
      }
    } catch {
      // File doesn't exist or can't be read — skip
    }

    if (hourMap.size > 0) {
      result.set(service, hourMap);
    }
  }

  return result;
}

/** Convert a Date to an hour key like "2026-02-12T14". */
function toHourKey(date: Date): string {
  return date.toISOString().slice(0, 13);
}

// ─── Update Baseline ────────────────────────────────────────

/**
 * Parse current logs and update the rolling baseline.
 * Call this periodically (e.g., every 6h from the health report cron).
 */
export async function updateBaseline(): Promise<ErrorBaseline> {
  const baseline = loadBaseline();
  const logCounts = await parseLogCounts();
  const now = new Date();
  const currentHourKey = toHourKey(now);

  for (const [service, hourMap] of logCounts) {
    let svc = baseline.services[service];
    if (!svc) {
      svc = {
        avgErrorsPerHour: 0,
        avgWarningsPerHour: 0,
        hourlyErrors: new Array(24).fill(0),
        hourlyWarnings: new Array(24).fill(0),
        lastUpdatedHour: currentHourKey,
        totalErrorSamples: 0,
        totalWarningSamples: 0,
      };
      baseline.services[service] = svc;
    }

    // Compute totals across all hours in the log
    let totalErrors = 0;
    let totalWarnings = 0;
    let hourCount = 0;
    const hourOfDayErrors = new Array(24).fill(0);
    const hourOfDayWarnings = new Array(24).fill(0);

    // Only count hours within the rolling window
    const windowStart = new Date(now.getTime() - ROLLING_HOURS * 60 * 60 * 1000);
    const windowStartKey = toHourKey(windowStart);

    for (const [hourKey, counts] of hourMap) {
      if (hourKey < windowStartKey) continue;

      totalErrors += counts.errors;
      totalWarnings += counts.warnings;
      hourCount++;

      // Extract hour-of-day for the pattern
      const hour = parseInt(hourKey.slice(11, 13), 10);
      hourOfDayErrors[hour] += counts.errors;
      hourOfDayWarnings[hour] += counts.warnings;
    }

    // Update rolling averages
    if (hourCount > 0) {
      svc.avgErrorsPerHour = totalErrors / hourCount;
      svc.avgWarningsPerHour = totalWarnings / hourCount;
      svc.totalErrorSamples = hourCount;
      svc.totalWarningSamples = hourCount;
    }

    // Update hourly patterns
    svc.hourlyErrors = hourOfDayErrors;
    svc.hourlyWarnings = hourOfDayWarnings;
    svc.lastUpdatedHour = currentHourKey;
  }

  baseline.updated = now.toISOString();
  saveBaseline(baseline);

  logger.info('Error baseline updated', {
    services: Object.keys(baseline.services).length,
    updated: baseline.updated,
  });

  return baseline;
}

// ─── Compare to Baseline ────────────────────────────────────

/** Minimum samples before baseline comparison is meaningful. */
const MIN_SAMPLES = 6;
/** Multiplier threshold to flag as anomaly. */
const ANOMALY_MULTIPLIER = 3.0;

/**
 * Compare current error/warning counts for a service against its baseline.
 */
export function compareToBaseline(
  baseline: ErrorBaseline,
  service: string,
  currentErrors: number,
  currentWarnings: number,
): BaselineComparison {
  const svc = baseline.services[service];

  if (!svc || svc.totalErrorSamples < MIN_SAMPLES) {
    // Not enough data for comparison
    return {
      service,
      currentErrors,
      currentWarnings,
      avgErrors: 0,
      avgWarnings: 0,
      errorMultiplier: 0,
      warningMultiplier: 0,
      isAnomaly: false,
    };
  }

  const errorMultiplier = svc.avgErrorsPerHour > 0
    ? currentErrors / svc.avgErrorsPerHour
    : currentErrors > 0 ? Infinity : 0;

  const warningMultiplier = svc.avgWarningsPerHour > 0
    ? currentWarnings / svc.avgWarningsPerHour
    : currentWarnings > 0 ? Infinity : 0;

  const isAnomaly = (
    (errorMultiplier >= ANOMALY_MULTIPLIER && currentErrors >= 3) ||
    (warningMultiplier >= ANOMALY_MULTIPLIER && currentWarnings >= 5)
  );

  return {
    service,
    currentErrors,
    currentWarnings,
    avgErrors: svc.avgErrorsPerHour,
    avgWarnings: svc.avgWarningsPerHour,
    errorMultiplier,
    warningMultiplier,
    isAnomaly,
  };
}

/**
 * Get current hour's error/warning counts per service from log files.
 * Lightweight — only reads the last 500 lines of each file.
 */
export async function getCurrentHourCounts(): Promise<Map<string, { errors: number; warnings: number }>> {
  const result = new Map<string, { errors: number; warnings: number }>();
  const now = new Date();
  const currentHourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0);

  for (const filename of SERVICE_LOG_FILES) {
    const service = basename(filename, '.log');
    let errors = 0;
    let warnings = 0;

    try {
      const content = await new Promise<string>((resolve, reject) => {
        readFile(join(LOGS_DIR, filename), 'utf-8', (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      });

      const lines = content.split('\n');
      const recent = lines.slice(-500);

      for (const line of recent) {
        const match = line.match(LOG_LINE_REGEX);
        if (!match) continue;

        const ts = new Date(match[1]);
        if (ts < currentHourStart) continue;

        if (match[2] === 'ERROR') errors++;
        else warnings++;
      }
    } catch {
      // File doesn't exist — skip
    }

    if (errors > 0 || warnings > 0) {
      result.set(service, { errors, warnings });
    }
  }

  return result;
}
