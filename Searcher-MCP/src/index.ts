/**
 * Searcher MCP Server - Entry Point
 */

import { loadEnvSafely } from "@mcp/shared/Utils/env.js";
loadEnvSafely(import.meta.url);

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { getConfig } from "./utils/config.js";
import { Logger } from "@mcp/shared/Utils/logger.js";

const logger = new Logger('searcher');

async function main() {
  // Validate config (will throw if BRAVE_API_KEY is missing)
  getConfig();

  const server = createServer();

  logger.info(`Starting Searcher MCP`, { transport: "stdio" });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`Searcher MCP running on stdio`);

  // Graceful shutdown
  process.on("SIGINT", () => {
    logger.info("Shutting down...");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logger.info("Shutting down...");
    process.exit(0);
  });
}

main().catch((error) => {
  logger.error("Fatal error", error);
  process.exit(1);
});
