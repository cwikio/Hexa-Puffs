/**
 * Telegram MCP Server
 * Provides Telegram messaging tools via MTProto protocol
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool } from "@mcp/shared/Utils/register-tool.js";
import {
  // Tool definitions (for descriptions)
  sendMessageTool,
  getMessagesTool,
  searchMessagesTool,
  deleteMessagesTool,
  listChatsTool,
  getChatTool,
  createGroupTool,
  listContactsTool,
  addContactTool,
  searchUsersTool,
  sendMediaTool,
  downloadMediaTool,
  getMeTool,
  markReadTool,
  getNewMessagesTool,
  subscribeChatTool,
  // Zod input schemas
  sendMessageSchema,
  getMessagesSchema,
  searchMessagesSchema,
  deleteMessagesSchema,
  listChatsSchema,
  getChatSchema,
  createGroupSchema,
  listContactsSchema,
  addContactSchema,
  searchUsersSchema,
  sendMediaSchema,
  downloadMediaSchema,
  getMeSchema,
  markReadSchema,
  getNewMessagesSchema,
  subscribeChatSchema,
  // Handlers
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
import type {
  SendMessageInput,
  GetMessagesInput,
  SearchMessagesInput,
  DeleteMessagesInput,
  ListChatsInput,
  GetChatInput,
  CreateGroupInput,
  AddContactInput,
  SearchUsersInput,
  SendMediaInput,
  DownloadMediaInput,
  MarkReadInput,
} from "./tools/index.js";

// registerTool handler receives Record<string, unknown>; the SDK validates input
// against the Zod schema before calling the handler, so the casts below are safe.

export function createServer(): McpServer {
  const server = new McpServer({
    name: "telegram-mcp",
    version: "1.0.0",
  });

  // Messages
  registerTool(server, {
    name: "send_message",
    description: sendMessageTool.description,
    inputSchema: sendMessageSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => ({ success: true, data: await handleSendMessage(params as SendMessageInput) }),
  });

  registerTool(server, {
    name: "get_messages",
    description: getMessagesTool.description,
    inputSchema: getMessagesSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params) => ({ success: true, data: await handleGetMessages(params as GetMessagesInput) }),
  });

  registerTool(server, {
    name: "search_messages",
    description: searchMessagesTool.description,
    inputSchema: searchMessagesSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params) => ({ success: true, data: await handleSearchMessages(params as SearchMessagesInput) }),
  });

  registerTool(server, {
    name: "delete_messages",
    description: deleteMessagesTool.description,
    inputSchema: deleteMessagesSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    handler: async (params) => ({ success: true, data: await handleDeleteMessages(params as DeleteMessagesInput) }),
  });

  // Chats
  registerTool(server, {
    name: "list_chats",
    description: listChatsTool.description,
    inputSchema: listChatsSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params) => ({ success: true, data: await handleListChats(params as ListChatsInput) }),
  });

  registerTool(server, {
    name: "get_chat",
    description: getChatTool.description,
    inputSchema: getChatSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params) => ({ success: true, data: await handleGetChat(params as GetChatInput) }),
  });

  registerTool(server, {
    name: "create_group",
    description: createGroupTool.description,
    inputSchema: createGroupSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => ({ success: true, data: await handleCreateGroup(params as CreateGroupInput) }),
  });

  // Contacts
  registerTool(server, {
    name: "list_contacts",
    description: listContactsTool.description,
    inputSchema: listContactsSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async () => ({ success: true, data: await handleListContacts() }),
  });

  registerTool(server, {
    name: "add_contact",
    description: addContactTool.description,
    inputSchema: addContactSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => ({ success: true, data: await handleAddContact(params as AddContactInput) }),
  });

  registerTool(server, {
    name: "search_users",
    description: searchUsersTool.description,
    inputSchema: searchUsersSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params) => ({ success: true, data: await handleSearchUsers(params as SearchUsersInput) }),
  });

  // Media
  registerTool(server, {
    name: "send_media",
    description: sendMediaTool.description,
    inputSchema: sendMediaSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => ({ success: true, data: await handleSendMedia(params as SendMediaInput) }),
  });

  registerTool(server, {
    name: "download_media",
    description: downloadMediaTool.description,
    inputSchema: downloadMediaSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params) => ({ success: true, data: await handleDownloadMedia(params as DownloadMediaInput) }),
  });

  // Utility
  registerTool(server, {
    name: "get_me",
    description: getMeTool.description,
    inputSchema: getMeSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async () => ({ success: true, data: await handleGetMe() }),
  });

  registerTool(server, {
    name: "mark_read",
    description: markReadTool.description,
    inputSchema: markReadSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => ({ success: true, data: await handleMarkRead(params as MarkReadInput) }),
  });

  // Realtime
  registerTool(server, {
    name: "get_new_messages",
    description: getNewMessagesTool.description,
    inputSchema: getNewMessagesSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params) => ({ success: true, data: await handleGetNewMessages(params) }),
  });

  registerTool(server, {
    name: "subscribe_chat",
    description: subscribeChatTool.description,
    inputSchema: subscribeChatSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params) => ({ success: true, data: await handleSubscribeChat(params) }),
  });

  return server;
}
