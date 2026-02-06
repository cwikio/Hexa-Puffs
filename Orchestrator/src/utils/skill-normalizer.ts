/**
 * Skill input normalizer and validator.
 *
 * Fixes common LLM mistakes when storing/updating skills:
 * - `trigger_config` flattened into root → re-nests
 * - `in_minutes` / `in_hours` → computes one-shot `at` timestamp
 * - Missing `trigger_type` → infers from trigger_config
 * - `required_tools` as string → parses to array
 * - `max_steps` as string → parses to number
 * - `notify_on_completion` as string → parses to boolean
 *
 * Also validates cron expressions before storage.
 */

import { Cron } from 'croner';
import { logger } from '@mcp/shared/Utils/logger.js';

// ─── Input Normalization ────────────────────────────────────────────

export function normalizeSkillInput(args: Record<string, unknown>): Record<string, unknown> {
  const result = { ...args };

  // 1. Re-nest flattened trigger_config fields
  if (!result.trigger_config) {
    const nested: Record<string, unknown> = {};
    let hasNested = false;

    if (result.schedule !== undefined) {
      nested.schedule = result.schedule;
      delete result.schedule;
      hasNested = true;
    }
    if (result.interval_minutes !== undefined) {
      nested.interval_minutes = result.interval_minutes;
      delete result.interval_minutes;
      hasNested = true;
    }
    if (result.timezone !== undefined && !result.trigger_config) {
      nested.timezone = result.timezone;
      delete result.timezone;
      hasNested = true;
    }
    if (result.at !== undefined) {
      nested.at = result.at;
      delete result.at;
      hasNested = true;
    }
    if (result.in_minutes !== undefined) {
      nested.in_minutes = result.in_minutes;
      delete result.in_minutes;
      hasNested = true;
    }
    if (result.in_hours !== undefined) {
      nested.in_hours = result.in_hours;
      delete result.in_hours;
      hasNested = true;
    }

    if (hasNested) {
      result.trigger_config = nested;
    }
  }

  // 2. Normalize trigger_config field names (LLM mistakes)
  if (result.trigger_config && typeof result.trigger_config === 'object') {
    const tc = result.trigger_config as Record<string, unknown>;
    // cronExpression / cron_expression / cron → schedule
    for (const alias of ['cronExpression', 'cron_expression', 'cron']) {
      if (tc[alias] !== undefined && tc.schedule === undefined) {
        tc.schedule = tc[alias];
        delete tc[alias];
      }
    }
    // intervalMinutes → interval_minutes
    if (tc.intervalMinutes !== undefined && tc.interval_minutes === undefined) {
      tc.interval_minutes = tc.intervalMinutes;
      delete tc.intervalMinutes;
    }

    // in_minutes / in_hours → one-shot "at" timestamp
    if (tc.in_minutes !== undefined) {
      if (tc.at === undefined) {
        const mins = Number(tc.in_minutes);
        if (!isNaN(mins) && mins > 0) {
          tc.at = new Date(Date.now() + mins * 60_000).toISOString();
          logger.info('Converted in_minutes to one-shot at', { in_minutes: mins, at: tc.at });
        }
      }
      delete tc.in_minutes;
    }
    if (tc.in_hours !== undefined) {
      if (tc.at === undefined) {
        const hrs = Number(tc.in_hours);
        if (!isNaN(hrs) && hrs > 0) {
          tc.at = new Date(Date.now() + hrs * 3_600_000).toISOString();
          logger.info('Converted in_hours to one-shot at', { in_hours: hrs, at: tc.at });
        }
      }
      delete tc.in_hours;
    }
  }

  // 3. Infer trigger_type from trigger_config
  if (!result.trigger_type && result.trigger_config) {
    const tc = result.trigger_config as Record<string, unknown>;
    if (tc.schedule || tc.interval_minutes) {
      result.trigger_type = 'cron';
    } else if (tc.at) {
      result.trigger_type = 'cron'; // one-shot is still cron trigger_type
    }
  }

  // 4. Parse required_tools
  if (typeof result.required_tools === 'string') {
    const str = result.required_tools.trim();
    if (str.startsWith('[')) {
      try {
        result.required_tools = JSON.parse(str);
      } catch {
        // If JSON parse fails, treat as single tool
        result.required_tools = [str];
      }
    } else if (str.length > 0) {
      // Single tool name as string → wrap in array
      result.required_tools = [str];
    }
  }

  // 5. Parse max_steps from string to number
  if (typeof result.max_steps === 'string') {
    const parsed = parseInt(result.max_steps, 10);
    if (!isNaN(parsed)) {
      result.max_steps = parsed;
    }
  }

  // 6. Parse notify_on_completion from string to boolean
  if (typeof result.notify_on_completion === 'string') {
    result.notify_on_completion = result.notify_on_completion === 'true';
  }

  // 7. Default agent_id to 'thinker' (the skill poller filters by this)
  if (!result.agent_id) {
    result.agent_id = 'thinker';
  }

  return result;
}

// ─── Cron Expression Validation ─────────────────────────────────────

export interface CronValidationResult {
  valid: boolean;
  error?: string;
}

export function validateCronExpression(expr: string): CronValidationResult {
  try {
    new Cron(expr);
    return { valid: true };
  } catch (e) {
    return {
      valid: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ─── Graduated Backoff ──────────────────────────────────────────────

const BACKOFF_MINUTES = [1, 5, 15, 60];
const MAX_CONSECUTIVE_FAILURES = 5;

/** In-memory failure counter per skill ID. Resets on restart (giving skills a fresh chance). */
const failureCountMap = new Map<number, number>();

export function getBackoffMinutes(skillId: number): number {
  const count = failureCountMap.get(skillId) ?? 0;
  return BACKOFF_MINUTES[Math.min(count, BACKOFF_MINUTES.length - 1)];
}

export function getConsecutiveFailures(skillId: number): number {
  return failureCountMap.get(skillId) ?? 0;
}

export function recordFailure(skillId: number): { count: number; shouldDisable: boolean } {
  const count = (failureCountMap.get(skillId) ?? 0) + 1;
  failureCountMap.set(skillId, count);
  return {
    count,
    shouldDisable: count >= MAX_CONSECUTIVE_FAILURES,
  };
}

export function recordSuccess(skillId: number): void {
  failureCountMap.delete(skillId);
}

/** Exported for testing — allows resetting the internal state. */
export function _resetFailureCounts(): void {
  failureCountMap.clear();
}

export { MAX_CONSECUTIVE_FAILURES };
