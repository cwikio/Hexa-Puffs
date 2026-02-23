import { loadEnvSafely } from '@mcp/shared/Utils/env.js';
loadEnvSafely(import.meta.url, 2);

import { ConfigSchema, type Config, type StdioMCPServerConfig, type HttpMCPServerConfig } from './schema.js';
import { ConfigurationError } from '../utils/errors.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  getEnvString,
  getEnvNumber,
  getEnvBoolean,
} from '@mcp/shared/Utils/config.js';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanForMCPs } from './scanner.js';
import { loadExternalMCPs } from '@mcp/shared/Discovery/external-loader.js';
import { PathManager } from '@mcp/shared/Utils/paths.js';

// Get the MCPs root directory (parent of Orchestrator)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Both compiled (dist/config/) and source (src/config/) are 3 levels from MCPs root:
// config → dist/src → Orchestrator → MCPs
const mcpsRoot = resolve(__dirname, '../../../');

export function loadConfig(): Config {
  const mcpConnectionMode = 'stdio' as const;

  // Auto-discover MCPs from sibling directories
  const discovered = scanForMCPs(mcpsRoot);

  // Build stdio configs from discovered MCPs (all MCPs are now stdio)
  const mcpServersStdio: Record<string, StdioMCPServerConfig> = {};

  for (const mcp of discovered) {
    const envPrefix = mcp.name.toUpperCase();
    const timeout = getEnvNumber(`${envPrefix}_MCP_TIMEOUT`, mcp.timeout);

    mcpServersStdio[mcp.name] = {
      command: mcp.command,
      args: [...mcp.commandArgs, mcp.entryPoint],
      cwd: mcp.dir,
      timeout: timeout ?? mcp.timeout,
      required: mcp.required,
      sensitive: mcp.sensitive,
      metadata: mcp.metadata,
    };
  }

  // Merge external MCPs from external-mcps.json in project root
  const externalResult = loadExternalMCPs(resolve(mcpsRoot, 'external-mcps.json'));
  if (externalResult.fileError) {
    logger.error('External MCPs file error', { error: externalResult.fileError });
  }
  for (const err of externalResult.errors) {
    logger.error(`External MCP "${err.name}" skipped: ${err.message}`);
  }
  const externalNames: string[] = [];
  const mcpServersHttp: Record<string, HttpMCPServerConfig> = {};
  for (const [name, entry] of Object.entries(externalResult.entries)) {
    if (mcpServersStdio[name]) {
      logger.warn('External MCP name conflicts with internal MCP — skipping', { name });
      continue;
    }
    externalNames.push(name);
    if (entry.type === 'http') {
      mcpServersHttp[name] = {
        url: entry.url,
        headers: entry.headers,
        timeout: entry.timeout,
        required: entry.required,
        sensitive: entry.sensitive,
        description: entry.description,
        metadata: entry.metadata,
      };
    } else {
      mcpServersStdio[name] = {
        command: entry.command,
        args: entry.args,
        env: entry.env,
        timeout: entry.timeout,
        required: entry.required,
        sensitive: entry.sensitive,
        description: entry.description,
        metadata: entry.metadata,
      };
    }
  }

  const rawConfig = {
    transport: getEnvString('TRANSPORT', 'stdio'),
    port: getEnvNumber('PORT', 8000),
    mcpConnectionMode,

    // Auto-discovered + external stdio MCP configs
    mcpServersStdio: Object.keys(mcpServersStdio).length > 0 ? mcpServersStdio : undefined,

    // External HTTP MCP configs
    mcpServersHttp: Object.keys(mcpServersHttp).length > 0 ? mcpServersHttp : undefined,

    security: {
      scanAllInputs: getEnvBoolean('SCAN_ALL_INPUTS', true),
      // Derive sensitive tools from MCP manifests: MCPs with sensitive: true
      // get prefix patterns (e.g. "onepassword_"), plus per-tool additions.
      sensitiveTools: [
        ...discovered
          .filter((mcp) => mcp.sensitive)
          .map((mcp) => `${mcp.name}_`),
        ...externalNames
          .filter((name) => externalResult.entries[name]?.sensitive)
          .map((name) => `${name}_`),
        'filer_create_file',
        'filer_update_file',
        'filer_read_file',
        'filer_search_files',
      ],
      failMode: getEnvString('SECURITY_FAIL_MODE', 'closed'),
    },

    // Channel polling: Orchestrator polls Telegram and dispatches to Thinker
    channelPolling: {
      enabled: getEnvBoolean('CHANNEL_POLLING_ENABLED', false),
      intervalMs: getEnvNumber('CHANNEL_POLL_INTERVAL_MS', 10000),
      maxMessagesPerCycle: getEnvNumber('CHANNEL_POLL_MAX_MESSAGES', 3),
    },

    thinkerUrl: getEnvString('THINKER_URL', 'http://localhost:8006'),

    // Multi-agent config: loaded from file (default: agents.json in HEXA_PUFFS_HOME or MCPs root)
    agentsConfigPath: process.env.AGENTS_CONFIG_PATH || join(PathManager.getInstance().getHomeDir(), 'config', 'agents.json'),

    // Track which MCPs came from external-mcps.json
    externalMCPNames: externalNames,

    // Auto-discovered channel MCPs
    channelMCPs: discovered
      .filter((mcp) => mcp.isChannel)
      .map((mcp) => ({ name: mcp.name, ...mcp.channelConfig })),

    logLevel: getEnvString('LOG_LEVEL', 'info'),
  };

  const result = ConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.flatten();
    logger.error('Configuration validation failed', errors);
    throw new ConfigurationError('Invalid configuration', errors);
  }

  logger.info('Configuration loaded successfully', {
    mcpConnectionMode,
    stdioMCPs: Object.keys(mcpServersStdio),
    ...(externalNames.length > 0 ? { externalMCPs: externalNames } : {}),
  });
  return result.data;
}

// Singleton config instance
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

export {
  type Config,
  type StdioMCPServerConfig,
  type HttpMCPServerConfig,
  type SecurityConfig,
  type ChannelPollingConfig,
} from './schema.js';

export {
  type AgentDefinition,
  type AgentsConfig,
  type ChannelBinding,
  type FullAgentsConfig,
  getDefaultAgent,
  loadAgentsFromFile,
} from './agents.js';
