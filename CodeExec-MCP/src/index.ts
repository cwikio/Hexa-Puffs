/**
 * CodeExec MCP Server — Entry Point
 *
 * Stdio transport, spawned by Orchestrator.
 */

import { loadEnvSafely } from '@mcp/shared/Utils/env.js';
loadEnvSafely(import.meta.url);

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
