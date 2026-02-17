/**
 * Loads external MCP configurations from external-mcps.json.
 *
 * The config file lives in the MCPs project root (next to agents.json).
 * The caller passes the path explicitly; there is no hidden default.
 *
 * Returns a record compatible with the Orchestrator's StdioMCPServerConfig,
 * ready to be merged into the mcpServersStdio map.
 *
 * Features:
 * - Returns empty record if the file doesn't exist (no error)
 * - Validates with Zod schema
 * - Resolves ${ENV_VAR} patterns in env values to actual process.env values
 */
import { readFileSync, existsSync } from 'node:fs';
import { ExternalMCPsFileSchema } from './external-config.js';
import { logger } from '../Utils/logger.js';
import type { MCPMetadata } from './types.js';

export interface ExternalMCPEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout: number;
  required: false; // External MCPs are never required
  sensitive: boolean;
  description?: string;
  metadata?: MCPMetadata;
}

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
 * Resolve ${ENV_VAR} placeholders in env values to actual environment values.
 */
function resolveEnvVars(env: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
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

/**
 * Load external MCP configs from the given path.
 *
 * @param configPath - Path to external-mcps.json. Required.
 */
export function loadExternalMCPs(
  configPath: string,
): Record<string, ExternalMCPEntry> {
  const filePath = configPath;

  if (!existsSync(filePath)) {
    return {};
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (error) {
    logger.warn('Failed to read external MCPs config', { path: filePath, error });
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    logger.error('Invalid JSON in external MCPs config', { path: filePath, error });
    return {};
  }

  const result = ExternalMCPsFileSchema.safeParse(parsed);
  if (!result.success) {
    logger.error('External MCPs config validation failed', {
      path: filePath,
      errors: result.error.flatten(),
    });
    return {};
  }

  const entries: Record<string, ExternalMCPEntry> = {};

  for (const [name, config] of Object.entries(result.data)) {
    entries[name] = {
      command: config.command,
      args: config.args ? resolveArgs(config.args) : undefined,
      env: config.env ? resolveEnvVars(config.env) : undefined,
      timeout: config.timeout,
      required: false,
      sensitive: config.sensitive,
      description: config.description,
      metadata: config.metadata,
    };
  }

  if (Object.keys(entries).length > 0) {
    logger.info('Loaded external MCPs', { names: Object.keys(entries) });
  }

  return entries;
}
