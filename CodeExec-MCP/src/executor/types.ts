/**
 * Core types for code execution.
 */

export interface ExecutionRequest {
  language: 'python' | 'node' | 'bash';
  code: string;
  timeout_ms: number;
  /** Absolute path. Empty string = create unique sandbox dir. */
  working_dir: string;
}

export interface ExecutionResult {
  execution_id: string;
  language: 'python' | 'node' | 'bash';
  stdout: string;
  stderr: string;
  exit_code: number | null;
  duration_ms: number;
  timed_out: boolean;
  truncated: boolean;
  artifacts: {
    created: string[];
    modified: string[];
    deleted: string[];
  };
}
