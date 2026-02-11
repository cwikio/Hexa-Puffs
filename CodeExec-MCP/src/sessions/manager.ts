/**
 * Session Manager — lifecycle for persistent REPL sessions.
 *
 * Manages long-lived Python/Node REPL processes using wrapper scripts
 * that implement a boundary/sentinel protocol for clean output detection.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { getConfig, getStrippedEnv, isForbiddenPath, expandHome } from '../config.js';
import { generateSessionId, generateExecutionId } from '../utils/id-generator.js';
import { truncateOutput } from '../utils/output-truncate.js';
import { logSessionEvent } from '../logging/writer.js';
import { Logger } from '@mcp/shared/Utils/logger.js';
import type {
  Session,
  SessionLanguage,
  SessionInfo,
  SessionExecResult,
  StartSessionResult,
  CloseSessionResult,
  PackageInstallResult,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WRAPPER_DIR = resolve(__dirname, 'wrappers');

const logger = new Logger('codexec:session');
const SIGKILL_GRACE_MS = 5_000;

export class SessionManager {
  private sessions = new Map<string, Session>();

  // ── Create ────────────────────────────────────────────────────────────────

  async startSession(opts: {
    language: SessionLanguage;
    name?: string;
    working_dir?: string;
  }): Promise<StartSessionResult> {
    const config = getConfig();

    if (this.sessions.size >= config.maxSessions) {
      throw new Error(
        `Maximum ${config.maxSessions} concurrent sessions reached. Close a session first.`,
      );
    }

    // Validate working_dir
    let workingDir: string;
    const sessionId = generateSessionId();

    if (opts.working_dir) {
      workingDir = resolve(expandHome(opts.working_dir));
      if (isForbiddenPath(workingDir)) {
        throw new Error(`forbidden path: ${opts.working_dir}`);
      }
    } else {
      workingDir = join(config.sandboxDir, sessionId);
    }

    await mkdir(workingDir, { recursive: true });

    // Determine wrapper script
    const wrapperFile =
      opts.language === 'python' ? 'python-repl.py' : 'node-repl.mjs';
    const wrapperPath = join(WRAPPER_DIR, wrapperFile);

    // Spawn the REPL process with ulimit resource constraints
    const maxFileBlocks = Math.floor(config.maxFileSizeBytes / 512);
    const limits = `ulimit -u ${config.maxProcesses} -f ${maxFileBlocks}`;
    const innerCmd = opts.language === 'python'
      ? `exec python3 -u "${wrapperPath}"`
      : `exec node "${wrapperPath}"`;

    const child = spawn('bash', ['-c', `${limits} && ${innerCmd}`], {
      cwd: workingDir,
      env: getStrippedEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!child.pid) {
      throw new Error(`Failed to spawn ${opts.language} REPL process`);
    }

    const now = new Date().toISOString();
    const name = opts.name || `${opts.language}-${sessionId.slice(5, 11)}`;

    const session: Session = {
      session_id: sessionId,
      language: opts.language,
      name,
      process: child,
      pid: child.pid,
      working_dir: workingDir,
      started_at: now,
      last_activity_at: now,
      executions_count: 0,
      packages_installed: [],
      pendingExec: Promise.resolve(),
      idleTimer: null,
    };

    this.sessions.set(sessionId, session);
    this.resetIdleTimer(session);

    // Handle unexpected process exit
    child.on('close', () => {
      if (this.sessions.has(sessionId)) {
        this.closeSession(sessionId, 'process_exit').catch((err) =>
          logger.error(`Auto-close failed for ${sessionId}: ${err}`),
        );
      }
    });

    // Log session start
    logSessionEvent({
      type: 'session_start',
      session_id: sessionId,
      language: opts.language,
      name,
      pid: child.pid,
      started_at: now,
    }).catch((err) => logger.error(`Log write failed: ${err}`));

    return {
      session_id: sessionId,
      language: opts.language,
      name,
      pid: child.pid,
      started_at: now,
    };
  }

  // ── Send Code ─────────────────────────────────────────────────────────────

  async sendToSession(opts: {
    sessionId?: string;
    language?: SessionLanguage;
    code: string;
    timeoutMs?: number;
  }): Promise<SessionExecResult>;
  async sendToSession(
    sessionId: string,
    code: string,
    timeoutMs?: number,
  ): Promise<SessionExecResult>;
  async sendToSession(
    optsOrId: string | { sessionId?: string; language?: SessionLanguage; code: string; timeoutMs?: number },
    codeArg?: string,
    timeoutMsArg?: number,
  ): Promise<SessionExecResult> {
    // Normalize to options object
    let sessionId: string | undefined;
    let language: SessionLanguage | undefined;
    let code: string;
    let timeoutMs: number | undefined;

    if (typeof optsOrId === 'string') {
      sessionId = optsOrId;
      code = codeArg!;
      timeoutMs = timeoutMsArg;
    } else {
      sessionId = optsOrId.sessionId;
      language = optsOrId.language;
      code = optsOrId.code;
      timeoutMs = optsOrId.timeoutMs;
    }

    // Auto-create session if no session_id provided, or if session_id
    // doesn't match any existing session and language IS provided
    // (handles LLMs that pass placeholder strings like "generated_session_id")
    let createdSession: SessionExecResult['created_session'];
    const needsAutoCreate =
      !sessionId || (language && !this.sessions.has(sessionId));

    if (needsAutoCreate) {
      if (!language) {
        // No language and invalid/missing session_id → normal "not found" error
        if (sessionId) {
          this.getSession(sessionId); // throws "not found"
        }
        throw new Error('language is required when session_id is not provided');
      }
      const startResult = await this.startSession({ language });
      sessionId = startResult.session_id;
      createdSession = {
        language: startResult.language,
        name: startResult.name,
        pid: startResult.pid,
        started_at: startResult.started_at,
      };
    }

    // sessionId is guaranteed to be set here: either from input, or from auto-create
    const session = this.getSession(sessionId!);

    // Chain on the previous execution to serialize sends
    const execPromise = session.pendingExec.then(() =>
      this.doSend(session, code, timeoutMs),
    );
    // Update chain (swallow errors so next exec isn't blocked)
    session.pendingExec = execPromise.then(
      () => {},
      () => {},
    );

    const result = await execPromise;

    if (createdSession) {
      result.created_session = createdSession;
    }

    return result;
  }

  private async doSend(
    session: Session,
    code: string,
    timeoutMs?: number,
  ): Promise<SessionExecResult> {
    const config = getConfig();
    const executionId = generateExecutionId();
    const timeout = Math.min(
      timeoutMs ?? config.defaultTimeoutMs,
      config.maxTimeoutMs,
    );

    this.resetIdleTimer(session);

    // Generate unique boundary/sentinel pair
    const uuid = randomUUID().slice(0, 8);
    const boundary = `__CODEXEC_BOUNDARY_${uuid}__`;
    const doneSentinel = `__CODEXEC_DONE_${uuid}__`;

    const startTime = Date.now();

    // Write code + boundary to stdin
    const { stdin } = session.process;
    if (!stdin || !stdin.writable) {
      throw new Error(`Session ${session.session_id} stdin is not writable (process may have exited)`);
    }

    stdin.write(code + '\n');
    stdin.write(boundary + '\n');

    // Collect output until sentinel or timeout
    const { stdout, stderr, timed_out } = await this.collectUntilSentinel(
      session,
      doneSentinel,
      timeout,
    );

    const duration = Date.now() - startTime;

    // Truncate output
    const truncConfig = {
      maxChars: config.maxOutputChars,
      head: config.truncationHead,
      tail: config.truncationTail,
    };
    const stdoutResult = truncateOutput(stdout, truncConfig);
    const stderrResult = truncateOutput(stderr, truncConfig);

    // Update session state
    session.executions_count++;
    session.last_activity_at = new Date().toISOString();

    // Log execution
    logSessionEvent({
      type: 'session_exec',
      execution_id: executionId,
      session_id: session.session_id,
      code,
      stdout: stdoutResult.text,
      stderr: stderrResult.text,
      duration_ms: duration,
      timed_out,
      at: session.last_activity_at,
    }).catch((err) => logger.error(`Log write failed: ${err}`));

    return {
      execution_id: executionId,
      session_id: session.session_id,
      stdout: stdoutResult.text,
      stderr: stderrResult.text,
      duration_ms: duration,
      truncated: stdoutResult.truncated || stderrResult.truncated,
      timed_out,
    };
  }

  // ── Sentinel-Based Output Collection ──────────────────────────────────────

  private collectUntilSentinel(
    session: Session,
    doneSentinel: string,
    timeoutMs: number,
  ): Promise<{ stdout: string; stderr: string; timed_out: boolean }> {
    return new Promise((resolve) => {
      let stdoutBuf = '';
      let stderrBuf = '';
      let timedOut = false;
      let settled = false;

      const { process: proc } = session;

      const onStdoutData = (chunk: Buffer) => {
        stdoutBuf += chunk.toString('utf-8');
        const idx = stdoutBuf.indexOf(doneSentinel);
        if (idx !== -1) {
          // Strip the sentinel line (and trailing newline)
          const output = stdoutBuf.slice(0, idx).replace(/\n$/, '');
          finish(output);
        }
      };

      const onStderrData = (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf-8');
      };

      const onClose = () => {
        // Process died before sentinel arrived
        finish(stdoutBuf);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        finish(stdoutBuf);
      }, timeoutMs);

      function finish(stdout: string) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        proc.stdout?.off('data', onStdoutData);
        proc.stderr?.off('data', onStderrData);
        proc.off('close', onClose);
        resolve({ stdout, stderr: stderrBuf, timed_out: timedOut });
      }

      proc.stdout?.on('data', onStdoutData);
      proc.stderr?.on('data', onStderrData);
      proc.on('close', onClose);
    });
  }

  // ── Close ─────────────────────────────────────────────────────────────────

  async closeSession(
    sessionId: string,
    reason: 'manual' | 'idle_timeout' | 'process_exit' = 'manual',
  ): Promise<CloseSessionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    this.clearIdleTimer(session);
    this.sessions.delete(sessionId);

    const totalDuration = Date.now() - new Date(session.started_at).getTime();

    // Kill the process if it's still alive
    if (reason !== 'process_exit') {
      try {
        // Close stdin to let wrapper exit cleanly
        session.process.stdin?.end();

        // Give it a moment to exit, then force-kill
        await new Promise<void>((resolve) => {
          const graceTimer = setTimeout(() => {
            try { session.process.kill('SIGTERM'); } catch { /* already dead */ }
            const killTimer = setTimeout(() => {
              try { session.process.kill('SIGKILL'); } catch { /* already dead */ }
              resolve();
            }, SIGKILL_GRACE_MS);
            session.process.on('close', () => {
              clearTimeout(killTimer);
              resolve();
            });
          }, 500);

          session.process.on('close', () => {
            clearTimeout(graceTimer);
            resolve();
          });
        });
      } catch {
        // Process may already be dead
      }
    }

    // Log session end
    logSessionEvent({
      type: 'session_end',
      session_id: sessionId,
      reason,
      total_duration_ms: totalDuration,
      executions_count: session.executions_count,
      at: new Date().toISOString(),
    }).catch((err) => logger.error(`Log write failed: ${err}`));

    return {
      session_id: sessionId,
      duration_total_ms: totalDuration,
      executions_count: session.executions_count,
      reason,
    };
  }

  // ── List ──────────────────────────────────────────────────────────────────

  async listSessions(): Promise<SessionInfo[]> {
    const infos: SessionInfo[] = [];
    for (const session of this.sessions.values()) {
      infos.push({
        session_id: session.session_id,
        language: session.language,
        name: session.name,
        pid: session.pid,
        started_at: session.started_at,
        last_activity_at: session.last_activity_at,
        executions_count: session.executions_count,
        packages_installed: [...session.packages_installed],
        memory_mb: this.getMemoryMb(session.pid),
      });
    }
    return infos;
  }

  // ── Package Install ───────────────────────────────────────────────────────

  async installPackage(opts: {
    language: SessionLanguage;
    packageName: string;
    sessionId?: string;
  }): Promise<PackageInstallResult> {
    const config = getConfig();

    // Validate language matches session if provided
    if (opts.sessionId) {
      const session = this.getSession(opts.sessionId);
      if (session.language !== opts.language) {
        throw new Error(
          `Language mismatch: session ${opts.sessionId} is ${session.language}, but install requested for ${opts.language}`,
        );
      }
    }

    // Determine install target directory
    let targetDir: string;
    if (opts.sessionId) {
      const session = this.getSession(opts.sessionId);
      targetDir = join(session.working_dir, 'site-packages');
    } else {
      targetDir = join(config.sandboxDir, 'global-packages', opts.language);
    }
    await mkdir(targetDir, { recursive: true });

    // Build install command
    let cmd: string;
    let args: string[];
    if (opts.language === 'python') {
      cmd = 'pip3';
      args = ['install', opts.packageName, '--target', targetDir, '--no-input'];
    } else {
      cmd = 'npm';
      args = ['install', opts.packageName, '--prefix', targetDir, '--no-audit', '--no-fund'];
    }

    // Run as subprocess
    const { stdout, stderr, success } = await this.runInstallCommand(cmd, args);
    const combinedOutput = (stdout + '\n' + stderr).trim();

    // Parse version from output
    const version = this.parseVersionFromOutput(opts.language, combinedOutput);

    // If session exists, inject path into the running REPL
    if (opts.sessionId && success) {
      const session = this.getSession(opts.sessionId);
      if (opts.language === 'python') {
        await this.sendToSession(
          session.session_id,
          `import sys\nif ${JSON.stringify(targetDir)} not in sys.path: sys.path.insert(0, ${JSON.stringify(targetDir)})`,
          5_000,
        );
      } else {
        await this.sendToSession(
          session.session_id,
          `if (!module.paths.includes(${JSON.stringify(join(targetDir, 'node_modules'))})) module.paths.unshift(${JSON.stringify(join(targetDir, 'node_modules'))})`,
          5_000,
        );
      }
      session.packages_installed.push(opts.packageName);
    }

    // Log package install
    if (opts.sessionId) {
      logSessionEvent({
        type: 'package_install',
        session_id: opts.sessionId,
        package_name: opts.packageName,
        version,
        success,
        at: new Date().toISOString(),
      }).catch((err) => logger.error(`Log write failed: ${err}`));
    }

    // Truncate output for response
    const truncConfig = {
      maxChars: config.maxOutputChars,
      head: config.truncationHead,
      tail: config.truncationTail,
    };
    const truncated = truncateOutput(combinedOutput, truncConfig);

    return {
      package_name: opts.packageName,
      version,
      install_output: truncated.text,
      success,
    };
  }

  // ── Shutdown All ──────────────────────────────────────────────────────────

  async shutdownAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.allSettled(
      ids.map((id) => this.closeSession(id, 'manual')),
    );
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private getSession(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    return session;
  }

  private resetIdleTimer(session: Session): void {
    this.clearIdleTimer(session);
    const config = getConfig();
    session.idleTimer = setTimeout(() => {
      this.closeSession(session.session_id, 'idle_timeout').catch((err) =>
        logger.error(`Idle close failed for ${session.session_id}: ${err}`),
      );
    }, config.sessionIdleTimeoutMs);
  }

  private clearIdleTimer(session: Session): void {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
  }

  private getMemoryMb(pid: number): number | null {
    try {
      const result = execSync(`ps -o rss= -p ${pid}`, {
        encoding: 'utf-8',
        timeout: 1_000,
      });
      const kb = parseInt(result.trim(), 10);
      if (isNaN(kb)) return null;
      return Math.round((kb / 1024) * 10) / 10;
    } catch {
      return null;
    }
  }

  private async runInstallCommand(
    cmd: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string; success: boolean }> {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        env: getStrippedEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
      }, 120_000); // 2 min timeout for package install

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          stdout: '',
          stderr: err.message,
          success: false,
        });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
          stderr: Buffer.concat(stderrChunks).toString('utf-8'),
          success: code === 0,
        });
      });
    });
  }

  private parseVersionFromOutput(language: SessionLanguage, output: string): string | null {
    if (language === 'python') {
      // pip: "Successfully installed pandas-2.2.1"
      const match = output.match(/Successfully installed\s+\S+-(\d+\.\d+[\d.]*)/);
      return match ? match[1] : null;
    } else {
      // npm: "added 1 package" or "+ package@version"
      const match = output.match(/\+ \S+@(\d+\.\d+[\d.]*)/);
      return match ? match[1] : null;
    }
  }
}
