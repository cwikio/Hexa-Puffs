/**
 * Subprocess sandbox executor.
 *
 * Spawns a child process to run code with:
 * - Stripped environment (no API keys/tokens)
 * - Timeout enforcement (SIGTERM → 5s grace → SIGKILL)
 * - Output capture and truncation
 * - Artifact detection via directory diff
 */

import { spawn } from 'node:child_process';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfig, getStrippedEnv } from '../config.js';
import { generateExecutionId } from '../utils/id-generator.js';
import { truncateOutput } from '../utils/output-truncate.js';
import { snapshotDir, diffSnapshots } from '../utils/artifact-diff.js';
import type { ExecutionRequest, ExecutionResult } from './types.js';

/** Map language to script filename */
const SCRIPT_FILES: Record<ExecutionRequest['language'], string> = {
  python: '_codexec_script.py',
  node: '_codexec_script.mjs',
  bash: '_codexec_script.sh',
};

/** Build ulimit prefix for resource constraints */
function getUlimitPrefix(): string {
  const config = getConfig();
  const maxFileBlocks = Math.floor(config.maxFileSizeBytes / 512);
  return `ulimit -u ${config.maxProcesses} -f ${maxFileBlocks}`;
}

/** Map language to command + args, wrapped with ulimit for resource protection */
function getCommand(language: ExecutionRequest['language'], scriptFile: string): [string, string[]] {
  const limits = getUlimitPrefix();
  switch (language) {
    case 'python': return ['bash', ['-c', `${limits} && exec python3 ${scriptFile}`]];
    case 'node': return ['bash', ['-c', `${limits} && exec node ${scriptFile}`]];
    case 'bash': return ['bash', ['-c', `${limits} && exec bash ${scriptFile}`]];
  }
}

const SIGKILL_GRACE_MS = 5_000;

export async function executeInSubprocess(
  request: ExecutionRequest,
): Promise<ExecutionResult> {
  const config = getConfig();
  const executionId = generateExecutionId();

  // Resolve working directory
  let workingDir: string;
  if (request.working_dir) {
    workingDir = request.working_dir;
    await mkdir(workingDir, { recursive: true });
  } else {
    workingDir = join(config.sandboxDir, executionId);
    await mkdir(workingDir, { recursive: true });
  }

  // Snapshot before execution
  const snapshotBefore = await snapshotDir(workingDir);

  // Write code to temp script file
  const scriptFile = SCRIPT_FILES[request.language];
  const scriptPath = join(workingDir, scriptFile);
  await writeFile(scriptPath, request.code, 'utf-8');

  // Spawn subprocess
  const [cmd, args] = getCommand(request.language, scriptFile);
  const startTime = Date.now();

  return new Promise<ExecutionResult>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    const child = spawn(cmd, args, {
      cwd: workingDir,
      env: getStrippedEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    // Handle spawn errors (e.g. command not found)
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimers();

      const duration = Date.now() - startTime;
      cleanup(scriptPath);

      resolve({
        execution_id: executionId,
        language: request.language,
        stdout: '',
        stderr: err.message,
        exit_code: 127,
        duration_ms: duration,
        timed_out: false,
        truncated: false,
        artifacts: { created: [], modified: [], deleted: [] },
      });
    });

    // Handle process exit
    child.on('close', async (code) => {
      if (settled) return;
      settled = true;
      clearTimers();

      const duration = Date.now() - startTime;

      // Collect and truncate output
      const rawStdout = Buffer.concat(stdoutChunks).toString('utf-8');
      const rawStderr = Buffer.concat(stderrChunks).toString('utf-8');

      const truncConfig = {
        maxChars: config.maxOutputChars,
        head: config.truncationHead,
        tail: config.truncationTail,
      };

      const stdoutResult = truncateOutput(rawStdout, truncConfig);
      const stderrResult = truncateOutput(rawStderr, truncConfig);
      const truncated = stdoutResult.truncated || stderrResult.truncated;

      // Artifact detection
      const snapshotAfter = await snapshotDir(workingDir);
      const diff = diffSnapshots(snapshotBefore, snapshotAfter);

      // Filter out the temp script from artifacts
      diff.created = diff.created.filter((f) => f !== scriptFile);
      diff.modified = diff.modified.filter((f) => f !== scriptFile);
      diff.deleted = diff.deleted.filter((f) => f !== scriptFile);

      // Cleanup temp script
      await cleanup(scriptPath);

      resolve({
        execution_id: executionId,
        language: request.language,
        stdout: stdoutResult.text,
        stderr: stderrResult.text,
        exit_code: code,
        duration_ms: duration,
        timed_out: timedOut,
        truncated,
        artifacts: diff,
      });
    });

    // Timeout enforcement
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');

      // Grace period, then SIGKILL
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Process may already be dead
        }
      }, SIGKILL_GRACE_MS);
    }, request.timeout_ms);

    function clearTimers(): void {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
    }
  });
}

async function cleanup(scriptPath: string): Promise<void> {
  try {
    await unlink(scriptPath);
  } catch {
    // Script may already be gone
  }
}
