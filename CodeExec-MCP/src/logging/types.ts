/**
 * Execution log entry types for JSONL logging.
 */

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
