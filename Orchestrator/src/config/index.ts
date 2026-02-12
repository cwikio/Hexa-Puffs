import { loadEnvSafely } from '@mcp/shared/Utils/env.js';
loadEnvSafely(import.meta.url, 2);

import { ConfigSchema, type Config, type StdioMCPServerConfig } from './schema.js';
import { ConfigurationError } from '../utils/errors.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  getEnvString,
  getEnvNumber,
  getEnvBoolean,
} from '@mcp/shared/Utils/config.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanForMCPs } from './scanner.js';

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
      command: 'node',
      args: [mcp.entryPoint],
      cwd: mcp.dir,
      timeout: timeout ?? mcp.timeout,
      required: mcp.required,
      sensitive: mcp.sensitive,
    };
  }

  const rawConfig = {
    transport: getEnvString('TRANSPORT', 'stdio'),
    port: getEnvNumber('PORT', 8000),
    mcpConnectionMode,

    // Auto-discovered MCP configs (all stdio)
    mcpServersStdio: Object.keys(mcpServersStdio).length > 0 ? mcpServersStdio : undefined,

    security: {
      scanAllInputs: getEnvBoolean('SCAN_ALL_INPUTS', true),
      // Derive sensitive tools from MCP manifests: MCPs with sensitive: true
      // get prefix patterns (e.g. "onepassword_"), plus per-tool additions.
      sensitiveTools: [
        ...discovered
          .filter((mcp) => mcp.sensitive)
          .map((mcp) => `${mcp.name}_`),
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

    // Multi-agent config: loaded from file (default: agents.json in MCPs root)
    agentsConfigPath: process.env.AGENTS_CONFIG_PATH || resolve(mcpsRoot, 'agents.json'),

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
