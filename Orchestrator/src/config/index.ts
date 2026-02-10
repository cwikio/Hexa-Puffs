import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'node:fs';
import { ConfigSchema, type Config, type StdioMCPServerConfig, type MCPServerConfig } from './schema.js';
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

// Only load .env if it exists — dotenv v17 writes to stdout otherwise
const envPath = resolve(__dirname, '../../.env');
if (existsSync(envPath)) {
  dotenvConfig({ path: envPath, quiet: true });
}
// Both compiled (dist/config/) and source (src/config/) are 3 levels from MCPs root:
// config → dist/src → Orchestrator → MCPs
const mcpsRoot = resolve(__dirname, '../../../');

export function loadConfig(): Config {
  const mcpConnectionMode = getEnvString('MCP_CONNECTION_MODE', 'stdio') as 'stdio' | 'http';

  // Auto-discover MCPs from sibling directories
  const discovered = scanForMCPs(mcpsRoot);

  // Build stdio configs from discovered MCPs
  const mcpServersStdio: Record<string, StdioMCPServerConfig> = {};
  const mcpServersHttp: Record<string, MCPServerConfig> = {};

  for (const mcp of discovered) {
    const envPrefix = mcp.name.toUpperCase();
    const timeout = getEnvNumber(`${envPrefix}_MCP_TIMEOUT`, mcp.timeout);

    if (mcp.transport === 'stdio') {
      mcpServersStdio[mcp.name] = {
        command: 'node',
        args: [mcp.entryPoint],
        cwd: mcp.dir,
        timeout: timeout ?? mcp.timeout,
        required: mcp.required,
        sensitive: mcp.sensitive,
      };
    }

    if (mcp.transport === 'http') {
      const port = mcp.httpPort ?? 8000;
      const envPort = getEnvNumber(`${envPrefix}_MCP_PORT`, port) ?? port;
      const defaultUrl = `http://localhost:${envPort}`;
      mcpServersHttp[mcp.name] = {
        url: getEnvString(`${envPrefix}_MCP_URL`, defaultUrl) ?? defaultUrl,
        timeout: timeout ?? mcp.timeout,
        required: mcp.required,
        sensitive: mcp.sensitive,
      };
    }
  }

  const rawConfig = {
    transport: getEnvString('TRANSPORT', 'stdio'),
    port: getEnvNumber('PORT', 8000),
    mcpConnectionMode,

    // Auto-discovered MCP configs
    mcpServersStdio: Object.keys(mcpServersStdio).length > 0 ? mcpServersStdio : undefined,
    mcpServers: Object.keys(mcpServersHttp).length > 0 ? mcpServersHttp : undefined,

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
    httpMCPs: Object.keys(mcpServersHttp),
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
  type MCPServerConfig,
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
