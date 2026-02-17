/**
 * Session types for persistent REPL sessions.
 */

import type { ChildProcess } from 'node:child_process';

export type SessionLanguage = 'python' | 'node';

/** Internal session state (includes process handle) */
export interface Session {
  session_id: string;
  language: SessionLanguage;
  name: string;
  process: ChildProcess;
  pid: number;
  working_dir: string;
  started_at: string;
  last_activity_at: string;
  executions_count: number;
  packages_installed: string[];
  /** Serialization: chains sequential send_to_session calls */
  pendingExec: Promise<void>;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

/** Public-facing session info (no process reference) */
export interface SessionInfo {
  session_id: string;
  language: SessionLanguage;
  name: string;
  pid: number;
  started_at: string;
  last_activity_at: string;
  executions_count: number;
  packages_installed: string[];
  memory_mb: number | null;
}

export interface SessionExecResult {
  execution_id: string;
  session_id: string;
  stdout: string;
  stderr: string;
  duration_ms: number;
  truncated: boolean;
  timed_out: boolean;
  /** Present when the session was auto-created by this call */
  created_session?: {
    language: SessionLanguage;
    name: string;
    pid: number;
    started_at: string;
  };
}

export interface StartSessionResult {
  session_id: string;
  language: SessionLanguage;
  name: string;
  pid: number;
  started_at: string;
}

export interface CloseSessionResult {
  session_id: string;
  duration_total_ms: number;
  executions_count: number;
  reason: 'manual' | 'idle_timeout' | 'process_exit';
}

export interface PackageInstallResult {
  package_name: string;
  version: string | null;
  install_output: string;
  success: boolean;
}
