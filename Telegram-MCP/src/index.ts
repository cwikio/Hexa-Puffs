// Load environment variables from .env file
import { config as dotenvConfig } from "dotenv";
dotenvConfig();

// Suppress console.log to prevent GramJS logs from polluting MCP stdout
// GramJS writes colored log messages to console.log which breaks JSON-RPC
console.log = () => {};

import { createServer } from "./server.js";
import { startTransport } from "@mcp/shared/Transport/dual-transport.js";
import { Logger } from "@mcp/shared/Utils/logger.js";
import { isClientConnected } from "./telegram/client.js";

const logger = new Logger('telegram');
import { allTools } from "./tools/index.js";

const transport = process.env.TRANSPORT || "stdio";
const port = parseInt(process.env.PORT || "3000", 10);

// Derive tool handlers from allTools — single source of truth
const toolHandlers: Record<string, (input: unknown) => Promise<unknown>> = Object.fromEntries(
  allTools.map(({ tool, handler }) => [tool.name, handler])
);

async function main() {
  const server = createServer();

  await startTransport(server, {
    transport: transport as "stdio" | "sse" | "http",
    port,
    serverName: "telegram-mcp",
    onHealth: () => {
      const connected = isClientConnected();
      return {
        status: connected ? "ok" : "degraded",
        telegramClient: connected ? "connected" : "disconnected",
        ...(connected ? {} : { message: "Telegram client not yet connected. Will connect on first tool call." }),
      };
    },
    tools: allTools.map(({ tool }) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
    onToolCall: async (name: string, args: unknown) => {
      const handler = toolHandlers[name];
      if (!handler) {
        throw new Error(`Unknown tool: ${name}`);
      }
      const output = await handler(args);
      return { success: true, data: output };
    },
  });
}

main().catch((error) => {
  logger.error("Fatal error", error);
  process.exit(1);
});
