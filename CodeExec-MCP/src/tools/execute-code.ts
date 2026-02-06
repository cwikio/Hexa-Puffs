/**
 * execute_code tool — one-shot sandboxed code execution.
 */

import { z } from 'zod';
import { resolve } from 'node:path';
import { getConfig, isForbiddenPath, expandHome } from '../config.js';
import { executeInSubprocess } from '../executor/subprocess.js';
import { logExecution } from '../logging/writer.js';
import { Logger } from '@mcp/shared/Utils/logger.js';
import type { ExecutionResult } from '../executor/types.js';

const logger = new Logger('codexec:exec');

export const executeCodeSchema = z.object({
  language: z.enum(['python', 'node', 'bash'])
    .describe('Programming language to execute'),
  code: z.string().min(1)
    .describe('Code to execute'),
  timeout_ms: z.number().int().positive().nullish()
    .describe('Execution timeout in milliseconds (default: 30000, max: 300000)'),
  working_dir: z.string().nullish()
    .describe('Working directory for execution (default: sandbox temp dir)'),
});

export type ExecuteCodeInput = z.infer<typeof executeCodeSchema>;

export async function handleExecuteCode(
  input: ExecuteCodeInput,
): Promise<ExecutionResult> {
  const config = getConfig();

  // Resolve and validate working_dir
  let workingDir = '';
  if (input.working_dir) {
    const expanded = expandHome(input.working_dir);
    const absolute = resolve(expanded);
    if (isForbiddenPath(absolute)) {
      throw new Error(`Working directory is in a forbidden path: ${input.working_dir}`);
    }
    workingDir = absolute;
  }

  // Clamp timeout
  const timeout = Math.min(
    input.timeout_ms ?? config.defaultTimeoutMs,
    config.maxTimeoutMs,
  );

  // Execute
  const result = await executeInSubprocess({
    language: input.language,
    code: input.code,
    timeout_ms: timeout,
    working_dir: workingDir,
  });

  // Log execution (fire-and-forget, don't block response)
  logExecution({
    type: 'execution',
    execution_id: result.execution_id,
    language: input.language,
    code: input.code,
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
    timed_out: result.timed_out,
    duration_ms: result.duration_ms,
    sandbox_mode: 'subprocess',
    working_dir: workingDir || `${config.sandboxDir}/${result.execution_id}`,
    artifacts: result.artifacts,
    executed_at: new Date().toISOString(),
  }).catch((err) => logger.error(`Log write failed: ${err}`));

  return result;
}
