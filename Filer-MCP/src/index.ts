/**
 * Filer MCP Server - Entry Point
 */

import { loadEnvSafely } from "@mcp/shared/Utils/env.js";
loadEnvSafely(import.meta.url);

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { initDatabase } from "./db/index.js";
import { loadConfigGrants, ensureSystemGrants } from "./db/grants.js";
import { initializeWorkspace } from "./utils/workspace.js";
import { getConfig } from "./utils/config.js";
import { cleanupTempFiles } from "./services/cleanup.js";
import { Logger } from "@mcp/shared/Utils/logger.js";

const logger = new Logger('filer');

async function main() {
  const config = getConfig();

  // Initialize grants storage
  try {
    await initDatabase();
    logger.info("Grants storage initialized");
  } catch (error) {
    logger.error("Grants storage initialization error:", error);
    process.exit(1);
  }

  // Load grants from config file
  try {
    const loadedGrants = await loadConfigGrants();
    if (loadedGrants > 0) {
      logger.info(`Loaded ${loadedGrants} grants from config`);
    }
  } catch (error) {
    logger.warn("Could not load config grants", error);
  }

  // Ensure built-in system grants for Annabelle directories
  try {
    const systemGrants = await ensureSystemGrants();
    if (systemGrants > 0) {
      logger.info(`Created ${systemGrants} system grants`);
    }
  } catch (error) {
    logger.warn("Could not create system grants", error);
  }

  // Initialize workspace
  try {
    await initializeWorkspace();
    logger.info(`Workspace initialized at: ${config.workspace.path}`);
  } catch (error) {
    logger.error("Workspace initialization error", error);
    process.exit(1);
  }

  // Clean up old temp files
  try {
    const cleanupResult = await cleanupTempFiles();
    if (cleanupResult.deleted > 0) {
      logger.info(`Temp cleanup: ${cleanupResult.deleted} files deleted (older than ${config.cleanup.tempDays} days)`);
    }
    if (cleanupResult.errors > 0) {
      logger.warn(`Temp cleanup: ${cleanupResult.errors} errors`);
    }
  } catch (error) {
    logger.warn("Temp cleanup failed", error);
  }

  const server = createServer();

  logger.info(`Starting Filer MCP`, { transport: "stdio" });
  logger.info(`Workspace: ${config.workspace.path}`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`Filer MCP running on stdio`);

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
