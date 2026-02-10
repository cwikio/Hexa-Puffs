/**
 * CodeExec MCP Server — Entry Point
 *
 * Stdio transport, spawned by Orchestrator.
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '../.env');
// Only load .env if it exists — dotenv v17 writes to stdout otherwise,
// which corrupts MCP stdio transport
if (existsSync(envPath)) {
  dotenvConfig({ path: envPath, quiet: true });
}

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { getConfig } from './config.js';
import { mkdir } from 'node:fs/promises';
import { Logger } from '@mcp/shared/Utils/logger.js';

const logger = new Logger('codexec');

async function main() {
  const config = getConfig();

  // Ensure sandbox, log, and scripts directories exist
  await mkdir(config.sandboxDir, { recursive: true });
  await mkdir(config.logDir, { recursive: true });
  await mkdir(config.scriptsDir, { recursive: true });

  logger.info('Starting CodeExec MCP', { transport: 'stdio' });
  logger.info(`Sandbox: ${config.sandboxDir}`);
  logger.info(`Logs: ${config.logDir}`);
  logger.info(`Scripts: ${config.scriptsDir}`);

  const { server, sessionManager } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown: close all sessions on exit
  const shutdown = async () => {
    await sessionManager.shutdownAll();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info('CodeExec MCP running on stdio');
}

main().catch((error) => {
  logger.error('Fatal error', error);
  process.exit(1);
});
