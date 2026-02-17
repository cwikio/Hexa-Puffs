// Messages
export {
  listEmailsTool, ListEmailsInputSchema, handleListEmails,
  getEmailTool, GetEmailInputSchema, handleGetEmail,
  sendEmailTool, SendEmailInputSchema, handleSendEmail,
  replyEmailTool, ReplyEmailInputSchema, handleReplyEmail,
  markReadTool, MarkReadInputSchema, handleMarkRead,
} from "./messages.js";

// Folders
export {
  listFoldersTool, ListFoldersInputSchema, handleListFolders,
} from "./folders.js";

// All tools array for registration and /tools/list
import {
  listEmailsTool, handleListEmails,
  getEmailTool, handleGetEmail,
  sendEmailTool, handleSendEmail,
  replyEmailTool, handleReplyEmail,
  markReadTool, handleMarkRead,
} from "./messages.js";
import { listFoldersTool, handleListFolders } from "./folders.js";

export const allTools = [
  { tool: listEmailsTool, handler: handleListEmails },
  { tool: getEmailTool, handler: handleGetEmail },
  { tool: sendEmailTool, handler: handleSendEmail },
  { tool: replyEmailTool, handler: handleReplyEmail },
  { tool: markReadTool, handler: handleMarkRead },
  { tool: listFoldersTool, handler: handleListFolders },
];
