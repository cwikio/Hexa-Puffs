/**
 * Script Library types.
 */

export type ScriptLanguage = 'python' | 'node' | 'bash';

export interface ScriptMetadata {
  name: string;
  description: string;
  language: ScriptLanguage;
  tags: string[];
  packages: string[];
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  run_count: number;
  last_run_success: boolean | null;
}

export interface SaveScriptResult {
  name: string;
  language: ScriptLanguage;
  created: boolean;
}

export interface GetScriptResult {
  code: string;
  metadata: ScriptMetadata;
}

export interface RunScriptResult {
  name: string;
  execution_id: string;
  language: ScriptLanguage;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  duration_ms: number;
  timed_out: boolean;
  truncated: boolean;
}

export interface SaveAndRunScriptResult {
  saved: SaveScriptResult;
  run: RunScriptResult;
}

export interface DeleteScriptResult {
  name: string;
  deleted: boolean;
}
