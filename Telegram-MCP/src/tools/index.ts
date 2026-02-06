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

// Input types
export type { SendMessageInput } from "./messages/send-message.js";
export type { GetMessagesInput } from "./messages/get-messages.js";
export type { SearchMessagesInput } from "./messages/search-messages.js";
export type { DeleteMessagesInput } from "./messages/delete-message.js";
export type { ListChatsInput } from "./chats/list-chats.js";
export type { GetChatInput } from "./chats/get-chat.js";
export type { CreateGroupInput } from "./chats/create-group.js";
export type { AddContactInput } from "./contacts/add-contact.js";
export type { SearchUsersInput } from "./contacts/search-contacts.js";
export type { SendMediaInput } from "./media/send-media.js";
export type { DownloadMediaInput } from "./media/download-media.js";
export type { MarkReadInput } from "./utility/mark-read.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolHandler = (input: any) => Promise<unknown>;

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

export const allTools: ToolEntry[] = [
  // Messages
  { tool: sendMessageTool, handler: handleSendMessage },
  { tool: getMessagesTool, handler: handleGetMessages },
  { tool: searchMessagesTool, handler: handleSearchMessages },
  { tool: deleteMessagesTool, handler: handleDeleteMessages },
  // Chats
  { tool: listChatsTool, handler: handleListChats },
  { tool: getChatTool, handler: handleGetChat },
  { tool: createGroupTool, handler: handleCreateGroup },
  // Contacts
  { tool: listContactsTool, handler: handleListContacts },
  { tool: addContactTool, handler: handleAddContact },
  { tool: searchUsersTool, handler: handleSearchUsers },
  // Media
  { tool: sendMediaTool, handler: handleSendMedia },
  { tool: downloadMediaTool, handler: handleDownloadMedia },
  // Utility
  { tool: getMeTool, handler: handleGetMe },
  { tool: markReadTool, handler: handleMarkRead },
  // Realtime
  { tool: getNewMessagesTool, handler: handleGetNewMessages },
  { tool: subscribeChatTool, handler: handleSubscribeChat },
];
