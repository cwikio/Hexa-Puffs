/**
 * JSONL log writers.
 *
 * - logExecution(): daily rotation for one-shot executions
 * - logSessionEvent(): per-session JSONL files for session lifecycle
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfig } from '../config.js';
import type { ExecutionLogEntry, SessionLogEntry } from './types.js';
import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('codexec:log');

/**
 * Append an execution log entry to the daily JSONL file.
 */
export async function logExecution(entry: ExecutionLogEntry): Promise<void> {
  const config = getConfig();

  await mkdir(config.logDir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const filename = `executions-${date}.jsonl`;
  const filepath = join(config.logDir, filename);

  const line = JSON.stringify(entry) + '\n';

  try {
    await appendFile(filepath, line, 'utf-8');
  } catch (err) {
    logger.error(`Failed to write log: ${err}`);
  }
}

/**
 * Append a session lifecycle event to the per-session JSONL file.
 */
export async function logSessionEvent(entry: SessionLogEntry): Promise<void> {
  const config = getConfig();

  await mkdir(config.logDir, { recursive: true });

  const sessionId = entry.session_id;
  const filename = `session-${sessionId}.jsonl`;
  const filepath = join(config.logDir, filename);

  const line = JSON.stringify(entry) + '\n';

  try {
    await appendFile(filepath, line, 'utf-8');
  } catch (err) {
    logger.error(`Failed to write session log: ${err}`);
  }
}
