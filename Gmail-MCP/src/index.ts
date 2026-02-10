#!/usr/bin/env node

// Load environment variables first
import { loadEnvSafely } from "@mcp/shared/Utils/env.js";
loadEnvSafely(import.meta.url);

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
    logger.error(
      "No Gmail OAuth token found. MCP will start in degraded mode — all tool calls will fail. Run 'npm run setup-oauth' to authenticate."
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
    onHealth: () => {
      const tokenValid = hasValidToken();
      return {
        status: tokenValid ? "ok" : "degraded",
        hasToken: tokenValid,
        ...(tokenValid ? {} : { message: "No Gmail OAuth token. Run 'npm run setup-oauth' to authenticate." }),
        toolCount: allTools.length,
      };
    },
    onToolCall: async (name: string, args: unknown) => {
      const handler = toolHandlers[name];
      if (!handler) {
        throw new Error(`Unknown tool: ${name}`);
      }
      if (!hasValidToken()) {
        throw new Error(
          "Gmail OAuth token missing or invalid. Run 'npm run setup-oauth' in the Gmail-MCP directory to authenticate."
        );
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
