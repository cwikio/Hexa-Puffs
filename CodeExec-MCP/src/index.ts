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

async function main() {
  const config = getConfig();

  // Ensure sandbox and log directories exist
  await mkdir(config.sandboxDir, { recursive: true });
  await mkdir(config.logDir, { recursive: true });

  console.error(`[${new Date().toISOString()}] [INFO] [codexec-mcp] Starting CodeExec MCP {"transport":"stdio"}`);
  console.error(`[${new Date().toISOString()}] [INFO] [codexec-mcp] Sandbox: ${config.sandboxDir}`);
  console.error(`[${new Date().toISOString()}] [INFO] [codexec-mcp] Logs: ${config.logDir}`);

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

  console.error(`[${new Date().toISOString()}] [INFO] [codexec-mcp] CodeExec MCP running on stdio`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
