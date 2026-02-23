/**
 * Loads external MCP configurations from external-mcps.json.
 *
 * The config file lives in the MCPs project root (next to agents.json).
 * The caller passes the path explicitly; there is no hidden default.
 *
 * Features:
 * - Returns empty result if the file doesn't exist (no error)
 * - Validates each entry individually — one bad entry doesn't break the rest
 * - Resolves ${ENV_VAR} patterns in env values, args, headers, and URLs
 * - Reports per-entry validation errors alongside valid entries
 * - Supports both stdio and HTTP transport types
 */
import { readFileSync, existsSync } from 'node:fs';
import { ExternalMCPConfigSchema } from './external-config.js';
import { logger } from '../Utils/logger.js';
import type { MCPMetadata } from './types.js';

// ── Entry types ──────────────────────────────────────────────────────

export interface ExternalMCPEntryBase {
  type: 'stdio' | 'http';
  timeout: number;
  required: false; // External MCPs are never required
  sensitive: boolean;
  description?: string;
  metadata?: MCPMetadata;
}

export interface StdioExternalMCPEntry extends ExternalMCPEntryBase {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface HttpExternalMCPEntry extends ExternalMCPEntryBase {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export type ExternalMCPEntry = StdioExternalMCPEntry | HttpExternalMCPEntry;

// ── Load result ──────────────────────────────────────────────────────

export interface ExternalMCPLoadResult {
  entries: Record<string, ExternalMCPEntry>;
  errors: Array<{ name: string; message: string }>;
  /** Set when the file itself is unreadable or malformed (bad JSON, not an object) */
  fileError?: string;
}

// ── Env-var resolution helpers ───────────────────────────────────────

const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Resolve ${ENV_VAR} placeholders in a single string.
 */
function resolveString(value: string): string {
  return value.replace(ENV_VAR_PATTERN, (_match, varName: string) => {
    return process.env[varName] ?? '';
  });
}

/**
 * Resolve ${ENV_VAR} placeholders in a string-keyed record.
 * Works for env vars, headers, or any Record<string, string>.
 */
function resolveRecord(record: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    resolved[key] = resolveString(value);
  }
  return resolved;
}

/**
 * Resolve ${ENV_VAR} placeholders in args array.
 */
function resolveArgs(args: string[]): string[] {
  return args.map(resolveString);
}

// ── Main loader ──────────────────────────────────────────────────────

const EMPTY_RESULT: ExternalMCPLoadResult = { entries: {}, errors: [] };

/**
 * Load external MCP configs from the given path.
 *
 * Validates each entry individually so one bad entry doesn't prevent
 * the rest from loading. Returns both valid entries and per-entry errors.
 *
 * Entries without an explicit `type` field are treated as stdio (backward compat).
 *
 * @param configPath - Path to external-mcps.json. Required.
 */
export function loadExternalMCPs(
  configPath: string,
): ExternalMCPLoadResult {
  const filePath = configPath;

  if (!existsSync(filePath)) {
    return EMPTY_RESULT;
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown read error';
    logger.warn('Failed to read external MCPs config', { path: filePath, error });
    return { entries: {}, errors: [], fileError: msg };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Invalid JSON';
    logger.error('Invalid JSON in external MCPs config', { path: filePath, error });
    return { entries: {}, errors: [], fileError: msg };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    const msg = 'Root must be a JSON object';
    logger.error(msg, { path: filePath });
    return { entries: {}, errors: [], fileError: msg };
  }

  const entries: Record<string, ExternalMCPEntry> = {};
  const errors: Array<{ name: string; message: string }> = [];

  for (const [name, rawConfig] of Object.entries(parsed as Record<string, unknown>)) {
    // Default type to 'stdio' for backward compatibility
    if (typeof rawConfig === 'object' && rawConfig !== null && !('type' in rawConfig)) {
      (rawConfig as Record<string, unknown>).type = 'stdio';
    }

    const result = ExternalMCPConfigSchema.safeParse(rawConfig);
    if (!result.success) {
      const flat = result.error.flatten();
      const message = Object.entries(flat.fieldErrors)
        .map(([field, msgs]) => `${field}: ${(msgs ?? []).join(', ')}`)
        .join('; ') || flat.formErrors.join('; ') || 'Invalid configuration';
      errors.push({ name, message });
      logger.warn(`External MCP "${name}" skipped — ${message}`);
      continue;
    }

    const config = result.data;
    const base = {
      timeout: config.timeout,
      required: false as const,
      sensitive: config.sensitive,
      description: config.description,
      metadata: config.metadata,
    };

    if (config.type === 'stdio') {
      entries[name] = {
        ...base,
        type: 'stdio',
        command: config.command,
        args: config.args ? resolveArgs(config.args) : undefined,
        env: config.env ? resolveRecord(config.env) : undefined,
      };
    } else {
      entries[name] = {
        ...base,
        type: 'http',
        url: resolveString(config.url),
        headers: config.headers ? resolveRecord(config.headers) : undefined,
      };
    }
  }

  if (Object.keys(entries).length > 0) {
    logger.info('Loaded external MCPs', { names: Object.keys(entries) });
  }
  if (errors.length > 0) {
    logger.warn('Some external MCPs had validation errors', {
      skipped: errors.map((e) => e.name),
    });
  }

  return { entries, errors };
}
