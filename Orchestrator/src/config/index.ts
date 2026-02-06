import { config as dotenvConfig } from 'dotenv';
import { ConfigSchema, type Config } from './schema.js';
import { ConfigurationError } from '../utils/errors.js';
import { logger } from '@mcp/shared/Utils/logger.js';
import {
  getEnvString,
  getEnvNumber,
  getEnvBoolean,
} from '@mcp/shared/Utils/config.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env file
dotenvConfig();

// Get the MCPs root directory (parent of Orchestrator)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Both compiled (dist/config/) and source (src/config/) are 3 levels from MCPs root:
// config → dist/src → Orchestrator → MCPs
const mcpsRoot = resolve(__dirname, '../../../');

export function loadConfig(): Config {
  const mcpConnectionMode = getEnvString('MCP_CONNECTION_MODE', 'stdio') as 'stdio' | 'http';

  const rawConfig = {
    transport: getEnvString('TRANSPORT', 'stdio'),
    port: getEnvNumber('PORT', 8000),
    mcpConnectionMode,

    // Stdio-based MCP configs (spawn processes)
    mcpServersStdio: {
      guardian: {
        command: 'node',
        args: [resolve(mcpsRoot, 'Guardian/dist/index.js')],
        cwd: resolve(mcpsRoot, 'Guardian'),
        timeout: getEnvNumber('GUARDIAN_MCP_TIMEOUT', 30000),
        required: false,
        sensitive: false,
      },
      telegram: {
        command: 'node',
        args: [resolve(mcpsRoot, 'Telegram-MCP/dist/src/index.js')],
        cwd: resolve(mcpsRoot, 'Telegram-MCP'),
        timeout: getEnvNumber('TELEGRAM_MCP_TIMEOUT', 30000),
        required: false,
        sensitive: true,
      },
      onepassword: {
        command: 'node',
        args: [resolve(mcpsRoot, 'Onepassword-MCP/dist/Onepassword/src/index.js')],
        cwd: resolve(mcpsRoot, 'Onepassword-MCP'),
        timeout: getEnvNumber('ONEPASSWORD_MCP_TIMEOUT', 30000),
        required: false,
        sensitive: true,
      },
      memory: {
        command: 'node',
        args: [resolve(mcpsRoot, 'Memorizer-MCP/dist/Memorizer-MCP/src/index.js')],
        cwd: resolve(mcpsRoot, 'Memorizer-MCP'),
        timeout: getEnvNumber('MEMORY_MCP_TIMEOUT', 30000),
        required: false,
        sensitive: false,
      },
      filer: {
        command: 'node',
        args: [resolve(mcpsRoot, 'Filer-MCP/dist/Filer/src/index.js')],
        cwd: resolve(mcpsRoot, 'Filer-MCP'),
        timeout: getEnvNumber('FILER_MCP_TIMEOUT', 30000),
        required: false,
        sensitive: true,
      },
      // Searcher runs as independent HTTP service, not spawned via stdio
    },

    // HTTP-based MCP configs (for backwards compatibility)
    mcpServers: {
      guardian: {
        url: getEnvString('GUARDIAN_MCP_URL', 'http://localhost:8003'),
        timeout: getEnvNumber('GUARDIAN_MCP_TIMEOUT', 5000),
        required: false,
        sensitive: false,
      },
      telegram: {
        url: getEnvString('TELEGRAM_MCP_URL', 'http://localhost:8002'),
        timeout: getEnvNumber('TELEGRAM_MCP_TIMEOUT', 5000),
        required: false,
        sensitive: true,
      },
      onepassword: {
        url: getEnvString('ONEPASSWORD_MCP_URL', 'http://localhost:8001'),
        timeout: getEnvNumber('ONEPASSWORD_MCP_TIMEOUT', 10000),
        required: false,
        sensitive: true,
      },
      memory: {
        url: getEnvString('MEMORY_MCP_URL', 'http://localhost:8005'),
        timeout: getEnvNumber('MEMORY_MCP_TIMEOUT', 10000),
        required: false,
        sensitive: false,
      },
      filer: {
        url: getEnvString('FILER_MCP_URL', 'http://localhost:8004'),
        timeout: getEnvNumber('FILER_MCP_TIMEOUT', 10000),
        required: false,
        sensitive: true,
      },
      searcher: {
        url: getEnvString('SEARCHER_MCP_URL', 'http://localhost:8007'),
        timeout: getEnvNumber('SEARCHER_MCP_TIMEOUT', 10000),
        required: false,
        sensitive: false,
      },
      gmail: {
        url: getEnvString('GMAIL_MCP_URL', 'http://localhost:8008'),
        timeout: getEnvNumber('GMAIL_MCP_TIMEOUT', 10000),
        required: false,
        sensitive: true,
      },
    },

    security: {
      scanAllInputs: getEnvBoolean('SCAN_ALL_INPUTS', true),
      sensitiveTools: [
        'onepassword_get',
        'telegram_send',
        'filer_create_file',
        'filer_update_file',
        'filer_read_file',
        'filer_search_files',
      ],
      failMode: getEnvString('SECURITY_FAIL_MODE', 'closed'),
    },

    thinkerUrl: getEnvString('THINKER_URL', 'http://localhost:8006'),

    logLevel: getEnvString('LOG_LEVEL', 'info'),
  };

  const result = ConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.flatten();
    logger.error('Configuration validation failed', errors);
    throw new ConfigurationError('Invalid configuration', errors);
  }

  logger.info('Configuration loaded successfully', { mcpConnectionMode });
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
} from './schema.js';
