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
import {
  allTools,
  handleSendMessage,
  handleGetMessages,
  handleSearchMessages,
  handleDeleteMessages,
  handleListChats,
  handleGetChat,
  handleCreateGroup,
  handleListContacts,
  handleAddContact,
  handleSearchUsers,
  handleSendMedia,
  handleDownloadMedia,
  handleGetMe,
  handleMarkRead,
  handleGetNewMessages,
  handleSubscribeChat,
} from "./tools/index.js";

const transport = process.env.TRANSPORT || "stdio";
const port = parseInt(process.env.PORT || "3000", 10);

// Tool handlers map for /tools/call endpoint
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toolHandlers: Record<string, (input: any) => Promise<unknown>> = {
  send_message: handleSendMessage,
  get_messages: handleGetMessages,
  search_messages: handleSearchMessages,
  delete_messages: handleDeleteMessages,
  list_chats: handleListChats,
  get_chat: handleGetChat,
  create_group: handleCreateGroup,
  list_contacts: handleListContacts,
  add_contact: handleAddContact,
  search_users: handleSearchUsers,
  send_media: handleSendMedia,
  download_media: handleDownloadMedia,
  get_me: handleGetMe,
  mark_read: handleMarkRead,
  get_new_messages: handleGetNewMessages,
  subscribe_chat: handleSubscribeChat,
};

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
