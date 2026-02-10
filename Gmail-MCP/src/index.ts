#!/usr/bin/env node

// Load environment variables first
import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "../.env");
// Only load .env if it exists — dotenv v17 writes to stdout otherwise
if (existsSync(envPath)) {
  dotenvConfig({ path: envPath, quiet: true });
}

import { initializeServer } from "./server.js";
import { getConfig } from "./config/index.js";
import { allTools } from "./tools/index.js";
import { logger } from "./utils/logger.js";
import { hasValidToken } from "./gmail/auth.js";
import { startPolling, stopPolling } from "./gmail/polling.js";
import { startTransport } from "@mcp/shared/Transport/dual-transport.js";

// Tool handlers map for /tools/call endpoint
const toolHandlers: Record<string, (input: unknown) => Promise<unknown>> = {};
for (const { tool, handler } of allTools) {
  toolHandlers[tool.name] = handler;
}

async function main(): Promise<void> {
  const config = getConfig();

  logger.info("Starting Gmail MCP", {
    transport: config.transport,
    port: config.port,
  });

  // Check for valid token
  if (!hasValidToken()) {
    logger.warn(
      "No Gmail token found. Please run 'npm run setup-oauth' to authenticate."
    );
  }

  const server = await initializeServer();

  await startTransport(server, {
    transport: config.transport as "stdio" | "sse" | "http",
    port: config.port,
    serverName: "gmail-mcp",
    tools: allTools.map(({ tool }) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
    onHealth: () => ({
      hasToken: hasValidToken(),
      toolCount: allTools.length,
    }),
    onToolCall: async (name: string, args: unknown) => {
      const handler = toolHandlers[name];
      if (!handler) {
        throw new Error(`Unknown tool: ${name}`);
      }
      return handler(args);
    },
    onShutdown: () => {
      stopPolling();
    },
    log: (message: string, data?: unknown) => {
      if (data) {
        logger.info(message, data);
      } else {
        logger.info(message);
      }
    },
  });

  // Start polling if enabled (after transport is ready)
  if (config.polling.enabled && hasValidToken()) {
    logger.info("Starting email polling", {
      intervalMs: config.polling.intervalMs,
    });
    startPolling(config.polling.intervalMs);
  }
}

main().catch((error) => {
  logger.error("Fatal error", { error });
  process.exit(1);
});
