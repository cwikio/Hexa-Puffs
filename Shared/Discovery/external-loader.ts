/**
 * Loads external MCP configurations from ~/.annabelle/external-mcps.json.
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
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { ExternalMCPsFileSchema } from './external-config.js';
import { logger } from '../Utils/logger.js';

export interface ExternalMCPEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeout: number;
  required: false; // External MCPs are never required
  sensitive: boolean;
}

const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Resolve ${ENV_VAR} placeholders in env values to actual environment values.
 */
function resolveEnvVars(env: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = value.replace(ENV_VAR_PATTERN, (_match, varName: string) => {
      return process.env[varName] ?? '';
    });
  }
  return resolved;
}

/**
 * Load external MCP configs from ~/.annabelle/external-mcps.json.
 *
 * @param configPath - Override path for testing. Defaults to ~/.annabelle/external-mcps.json.
 */
export function loadExternalMCPs(
  configPath?: string,
): Record<string, ExternalMCPEntry> {
  const filePath = configPath ?? resolve(homedir(), '.annabelle', 'external-mcps.json');

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
      args: config.args,
      env: config.env ? resolveEnvVars(config.env) : undefined,
      timeout: config.timeout,
      required: false,
      sensitive: config.sensitive,
    };
  }

  if (Object.keys(entries).length > 0) {
    logger.info('Loaded external MCPs', { names: Object.keys(entries) });
  }

  return entries;
}
