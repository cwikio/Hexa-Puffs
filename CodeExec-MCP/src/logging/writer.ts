/**
 * JSONL log writer for execution entries.
 *
 * Daily rotation: one file per day (executions-YYYY-MM-DD.jsonl).
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfig } from '../config.js';
import type { ExecutionLogEntry } from './types.js';

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
    console.error(`[codexec] Failed to write log: ${err}`);
  }
}
