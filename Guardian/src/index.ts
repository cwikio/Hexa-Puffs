/**
 * Guardian MCP Server - Entry Point (stdio transport)
 */

import { loadEnvSafely } from "@mcp/shared/Utils/env.js";
loadEnvSafely(import.meta.url);

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { verifyConnection, getHost, getModelName, getProviderName } from "./provider.js";
import { Logger } from "@mcp/shared/Utils/logger.js";

const logger = new Logger('guardian');

async function main() {
  const provider = getProviderName();
  try {
    await verifyConnection();
    logger.info(`Connected to ${provider} at ${getHost()}`);
    logger.info(`Using model: ${getModelName()}`);
  } catch (error) {
    logger.warn(error instanceof Error ? error.message : `Cannot connect to ${provider}`);
    logger.warn(`Scans will fail until ${provider} is available.`);
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Guardian MCP server running on stdio");
}

main().catch((error) => {
  logger.error("Fatal error", error);
  process.exit(1);
});
