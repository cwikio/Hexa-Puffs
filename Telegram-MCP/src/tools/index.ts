// Messages
import { sendMessageTool, handleSendMessage, sendMessageSchema } from "./messages/send-message.js";
import { getMessagesTool, handleGetMessages, getMessagesSchema } from "./messages/get-messages.js";
import { searchMessagesTool, handleSearchMessages, searchMessagesSchema } from "./messages/search-messages.js";
import { deleteMessagesTool, handleDeleteMessages, deleteMessagesSchema } from "./messages/delete-message.js";

// Chats
import { listChatsTool, handleListChats, listChatsSchema } from "./chats/list-chats.js";
import { getChatTool, handleGetChat, getChatSchema } from "./chats/get-chat.js";
import { createGroupTool, handleCreateGroup, createGroupSchema } from "./chats/create-group.js";

// Contacts
import { listContactsTool, handleListContacts, listContactsSchema } from "./contacts/list-contacts.js";
import { addContactTool, handleAddContact, addContactSchema } from "./contacts/add-contact.js";
import { searchUsersTool, handleSearchUsers, searchUsersSchema } from "./contacts/search-contacts.js";

// Media
import { sendMediaTool, handleSendMedia, sendMediaSchema } from "./media/send-media.js";
import { downloadMediaTool, handleDownloadMedia, downloadMediaSchema } from "./media/download-media.js";

// Utility
import { getMeTool, handleGetMe, getMeSchema } from "./utility/get-me.js";
import { markReadTool, handleMarkRead, markReadSchema } from "./utility/mark-read.js";

// Realtime
import { getNewMessagesTool, handleGetNewMessages, getNewMessagesSchema } from "./realtime/get-new-messages.js";
import { subscribeChatTool, handleSubscribeChat, subscribeChatSchema } from "./realtime/subscribe-chat.js";

// Re-export all
export {
  // Messages
  sendMessageTool,
  handleSendMessage,
  sendMessageSchema,
  getMessagesTool,
  handleGetMessages,
  getMessagesSchema,
  searchMessagesTool,
  handleSearchMessages,
  searchMessagesSchema,
  deleteMessagesTool,
  handleDeleteMessages,
  deleteMessagesSchema,
  // Chats
  listChatsTool,
  handleListChats,
  listChatsSchema,
  getChatTool,
  handleGetChat,
  getChatSchema,
  createGroupTool,
  handleCreateGroup,
  createGroupSchema,
  // Contacts
  listContactsTool,
  handleListContacts,
  listContactsSchema,
  addContactTool,
  handleAddContact,
  addContactSchema,
  searchUsersTool,
  handleSearchUsers,
  searchUsersSchema,
  // Media
  sendMediaTool,
  handleSendMedia,
  sendMediaSchema,
  downloadMediaTool,
  handleDownloadMedia,
  downloadMediaSchema,
  // Utility
  getMeTool,
  handleGetMe,
  getMeSchema,
  markReadTool,
  handleMarkRead,
  markReadSchema,
  // Realtime
  getNewMessagesTool,
  handleGetNewMessages,
  getNewMessagesSchema,
  subscribeChatTool,
  handleSubscribeChat,
  subscribeChatSchema,
};

import type { z } from "zod";
import type { ToolHandler } from "@mcp/shared/Types/tools.js";

interface ToolEntry {
  tool: {
    name: string;
    description: string;
    inputSchema: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
  handler: ToolHandler;
}

function createToolEntry<T>(
  tool: ToolEntry["tool"],
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  handler: (input: T) => Promise<unknown>
): ToolEntry {
  return {
    tool,
    handler(input: unknown): Promise<unknown> {
      return handler(schema.parse(input));
    }
  };
}

export const allTools: ToolEntry[] = [
  // Messages
  createToolEntry(sendMessageTool, sendMessageSchema, handleSendMessage),
  createToolEntry(getMessagesTool, getMessagesSchema, handleGetMessages),
  createToolEntry(searchMessagesTool, searchMessagesSchema, handleSearchMessages),
  createToolEntry(deleteMessagesTool, deleteMessagesSchema, handleDeleteMessages),
  // Chats
  createToolEntry(listChatsTool, listChatsSchema, handleListChats),
  createToolEntry(getChatTool, getChatSchema, handleGetChat),
  createToolEntry(createGroupTool, createGroupSchema, handleCreateGroup),
  // Contacts
  createToolEntry(listContactsTool, listContactsSchema, handleListContacts),
  createToolEntry(addContactTool, addContactSchema, handleAddContact),
  createToolEntry(searchUsersTool, searchUsersSchema, handleSearchUsers),
  // Media
  createToolEntry(sendMediaTool, sendMediaSchema, handleSendMedia),
  createToolEntry(downloadMediaTool, downloadMediaSchema, handleDownloadMedia),
  // Utility
  createToolEntry(getMeTool, getMeSchema, handleGetMe),
  createToolEntry(markReadTool, markReadSchema, handleMarkRead),
  // Realtime
  createToolEntry(getNewMessagesTool, getNewMessagesSchema, handleGetNewMessages),
  createToolEntry(subscribeChatTool, subscribeChatSchema, handleSubscribeChat),
];
