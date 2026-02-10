/**
 * Log entry types for JSONL logging.
 *
 * - ExecutionLogEntry: one-shot executions (daily rotation)
 * - SessionLogEntry: session lifecycle events (per-session files)
 */

// ── Stateless Execution Logs ────────────────────────────────────────────────

export interface ExecutionLogEntry {
  type: 'execution';
  execution_id: string;
  language: 'python' | 'node' | 'bash';
  code: string;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  duration_ms: number;
  sandbox_mode: 'subprocess';
  working_dir: string;
  artifacts: {
    created: string[];
    modified: string[];
    deleted: string[];
  };
  executed_at: string;
}

// ── Session Lifecycle Logs ──────────────────────────────────────────────────

export interface SessionStartLogEntry {
  type: 'session_start';
  session_id: string;
  language: 'python' | 'node';
  name: string;
  pid: number;
  started_at: string;
}

export interface SessionExecLogEntry {
  type: 'session_exec';
  execution_id: string;
  session_id: string;
  code: string;
  stdout: string;
  stderr: string;
  duration_ms: number;
  timed_out: boolean;
  at: string;
}

export interface SessionEndLogEntry {
  type: 'session_end';
  session_id: string;
  reason: 'manual' | 'idle_timeout' | 'process_exit';
  total_duration_ms: number;
  executions_count: number;
  at: string;
}

export interface PackageInstallLogEntry {
  type: 'package_install';
  session_id: string;
  package_name: string;
  version: string | null;
  success: boolean;
  at: string;
}

export type SessionLogEntry =
  | SessionStartLogEntry
  | SessionExecLogEntry
  | SessionEndLogEntry
  | PackageInstallLogEntry;
