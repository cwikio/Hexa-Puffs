/**
 * Outlook MCP Server
 * Provides Microsoft Outlook / Exchange email tools via Graph API
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool } from "@mcp/shared/Utils/register-tool.js";
import {
  listEmailsTool, ListEmailsInputSchema, handleListEmails,
  getEmailTool, GetEmailInputSchema, handleGetEmail,
  sendEmailTool, SendEmailInputSchema, handleSendEmail,
  replyEmailTool, ReplyEmailInputSchema, handleReplyEmail,
  markReadTool, MarkReadInputSchema, handleMarkRead,
  listFoldersTool, ListFoldersInputSchema, handleListFolders,
} from "./tools/index.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "outlook-mcp",
    version: "1.0.0",
  });

  // Messages
  registerTool(server, {
    name: "list_emails",
    description: listEmailsTool.description,
    inputSchema: ListEmailsInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleListEmails(params),
  });

  registerTool(server, {
    name: "get_email",
    description: getEmailTool.description,
    inputSchema: GetEmailInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleGetEmail(params),
  });

  registerTool(server, {
    name: "send_email",
    description: sendEmailTool.description,
    inputSchema: SendEmailInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleSendEmail(params),
  });

  registerTool(server, {
    name: "reply_email",
    description: replyEmailTool.description,
    inputSchema: ReplyEmailInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleReplyEmail(params),
  });

  registerTool(server, {
    name: "mark_read",
    description: markReadTool.description,
    inputSchema: MarkReadInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    handler: async (params) => handleMarkRead(params),
  });

  // Folders
  registerTool(server, {
    name: "list_folders",
    description: listFoldersTool.description,
    inputSchema: ListFoldersInputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async () => handleListFolders(),
  });

  return server;
}

export async function initializeServer(): Promise<McpServer> {
  return createServer();
}
