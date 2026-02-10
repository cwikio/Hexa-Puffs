/**
 * CodeExec MCP Configuration
 *
 * Zod-validated environment config, forbidden path checking,
 * and environment stripping for subprocess sandboxing.
 */

import { z } from 'zod';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

// ── Schema ───────────────────────────────────────────────────────────────────

const configSchema = z.object({
  sandboxDir: z.string().default('~/.annabelle/codexec/sandbox'),
  defaultTimeoutMs: z.coerce.number().int().positive().default(30_000),
  maxTimeoutMs: z.coerce.number().int().positive().default(300_000),
  maxOutputChars: z.coerce.number().int().positive().default(10_000),
  truncationHead: z.coerce.number().int().positive().default(4_000),
  truncationTail: z.coerce.number().int().positive().default(4_000),
  logDir: z.string().default('~/.annabelle/codexec/logs'),
  sessionIdleTimeoutMs: z.coerce.number().int().positive().default(900_000), // 15 min
  maxSessions: z.coerce.number().int().positive().default(5),
  scriptsDir: z.string().default('~/.annabelle/scripts'),
  maxProcesses: z.coerce.number().int().positive().default(64),
  maxFileSizeBytes: z.coerce.number().int().positive().default(52_428_800), // 50MB
});

export type CodeExecConfig = z.infer<typeof configSchema>;

// ── Helpers ──────────────────────────────────────────────────────────────────

export function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return p.replace('~', homedir());
  }
  return p;
}

// ── Singleton ────────────────────────────────────────────────────────────────

let cached: CodeExecConfig | null = null;

export function getConfig(): CodeExecConfig {
  if (cached) return cached;

  const raw = {
    sandboxDir: process.env.CODEXEC_SANDBOX_DIR,
    defaultTimeoutMs: process.env.CODEXEC_DEFAULT_TIMEOUT_MS,
    maxTimeoutMs: process.env.CODEXEC_MAX_TIMEOUT_MS,
    maxOutputChars: process.env.CODEXEC_MAX_OUTPUT_CHARS,
    truncationHead: process.env.CODEXEC_TRUNCATION_HEAD,
    truncationTail: process.env.CODEXEC_TRUNCATION_TAIL,
    logDir: process.env.CODEXEC_LOG_DIR,
    sessionIdleTimeoutMs: process.env.CODEXEC_SESSION_IDLE_TIMEOUT_MS,
    maxSessions: process.env.CODEXEC_MAX_SESSIONS,
    scriptsDir: process.env.CODEXEC_SCRIPTS_DIR,
    maxProcesses: process.env.CODEXEC_MAX_PROCESSES,
    maxFileSizeBytes: process.env.CODEXEC_MAX_FILE_SIZE_BYTES,
  };

  // Strip undefined keys so Zod defaults kick in
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined),
  );

  const result = configSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`CodeExec config error: ${result.error.message}`);
  }

  // Expand ~ in paths
  const config = result.data;
  config.sandboxDir = resolve(expandHome(config.sandboxDir));
  config.logDir = resolve(expandHome(config.logDir));
  config.scriptsDir = resolve(expandHome(config.scriptsDir));

  cached = config;
  return config;
}

/** Reset cached config (for testing) */
export function resetConfig(): void {
  cached = null;
}

// ── Forbidden Paths ──────────────────────────────────────────────────────────

const FORBIDDEN_PREFIXES = [
  '~/.ssh',
  '~/.gnupg',
  '~/.aws',
  '~/.config',
  '~/.annabelle/data',
  '/etc',
  '/var',
].map((p) => resolve(expandHome(p)));

/**
 * Check if an absolute path falls under a forbidden prefix.
 */
export function isForbiddenPath(absolutePath: string): boolean {
  const normalized = resolve(absolutePath);
  return FORBIDDEN_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(prefix + '/'),
  );
}

// ── Stripped Environment ─────────────────────────────────────────────────────

const ENV_ALLOWLIST = ['PATH', 'HOME', 'LANG', 'TERM', 'TMPDIR', 'USER'];

/**
 * Build a minimal environment for subprocess execution.
 * Only allowlisted vars pass through — no API keys, tokens, or secrets.
 */
export function getStrippedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const val = process.env[key];
    if (val !== undefined) {
      env[key] = val;
    }
  }
  return env;
}
