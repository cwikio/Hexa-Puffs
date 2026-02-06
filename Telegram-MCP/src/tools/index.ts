// Messages
import { sendMessageTool, handleSendMessage } from "./messages/send-message.js";
import { getMessagesTool, handleGetMessages } from "./messages/get-messages.js";
import { searchMessagesTool, handleSearchMessages } from "./messages/search-messages.js";
import { deleteMessagesTool, handleDeleteMessages } from "./messages/delete-message.js";

// Chats
import { listChatsTool, handleListChats } from "./chats/list-chats.js";
import { getChatTool, handleGetChat } from "./chats/get-chat.js";
import { createGroupTool, handleCreateGroup } from "./chats/create-group.js";

// Contacts
import { listContactsTool, handleListContacts } from "./contacts/list-contacts.js";
import { addContactTool, handleAddContact } from "./contacts/add-contact.js";
import { searchUsersTool, handleSearchUsers } from "./contacts/search-contacts.js";

// Media
import { sendMediaTool, handleSendMedia } from "./media/send-media.js";
import { downloadMediaTool, handleDownloadMedia } from "./media/download-media.js";

// Utility
import { getMeTool, handleGetMe } from "./utility/get-me.js";
import { markReadTool, handleMarkRead } from "./utility/mark-read.js";

// Realtime
import { getNewMessagesTool, handleGetNewMessages } from "./realtime/get-new-messages.js";
import { subscribeChatTool, handleSubscribeChat } from "./realtime/subscribe-chat.js";

// Re-export all
export {
  // Messages
  sendMessageTool,
  handleSendMessage,
  getMessagesTool,
  handleGetMessages,
  searchMessagesTool,
  handleSearchMessages,
  deleteMessagesTool,
  handleDeleteMessages,
  // Chats
  listChatsTool,
  handleListChats,
  getChatTool,
  handleGetChat,
  createGroupTool,
  handleCreateGroup,
  // Contacts
  listContactsTool,
  handleListContacts,
  addContactTool,
  handleAddContact,
  searchUsersTool,
  handleSearchUsers,
  // Media
  sendMediaTool,
  handleSendMedia,
  downloadMediaTool,
  handleDownloadMedia,
  // Utility
  getMeTool,
  handleGetMe,
  markReadTool,
  handleMarkRead,
  // Realtime
  getNewMessagesTool,
  handleGetNewMessages,
  subscribeChatTool,
  handleSubscribeChat,
};

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
