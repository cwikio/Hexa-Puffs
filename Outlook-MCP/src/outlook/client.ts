import { Client } from "@microsoft/microsoft-graph-client";
import { getAccessToken } from "./auth.js";
import { logger } from "../utils/logger.js";
import type {
  EmailMessage,
  EmailSummary,
  EmailAddress,
  ListEmailsOptions,
  ListEmailsResult,
  SendEmailOptions,
  MailFolder,
} from "../types/outlook.js";

let graphClient: Client | null = null;

/**
 * Get or create the Microsoft Graph client
 */
async function getGraphClient(): Promise<Client> {
  if (graphClient) {
    return graphClient;
  }

  graphClient = Client.init({
    authProvider: async (done) => {
      try {
        const token = await getAccessToken();
        done(null, token);
      } catch (err) {
        done(err instanceof Error ? err : new Error(String(err)), null);
      }
    },
  });

  return graphClient;
}

// ============ HELPERS ============

function parseGraphAddress(
  addr: { emailAddress?: { address?: string; name?: string } } | undefined
): EmailAddress {
  return {
    email: addr?.emailAddress?.address ?? "",
    name: addr?.emailAddress?.name ?? undefined,
  };
}

function parseGraphAddressList(
  addrs: Array<{ emailAddress?: { address?: string; name?: string } }> | undefined
): EmailAddress[] {
  if (!addrs) return [];
  return addrs.map(parseGraphAddress);
}

interface GraphMessage {
  id?: string;
  conversationId?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>;
  ccRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>;
  bccRecipients?: Array<{ emailAddress?: { address?: string; name?: string } }>;
  receivedDateTime?: string;
  body?: { contentType?: string; content?: string };
  bodyPreview?: string;
  hasAttachments?: boolean;
  isRead?: boolean;
  importance?: string;
  parentFolderId?: string;
}

function toEmailSummary(msg: GraphMessage): EmailSummary {
  return {
    id: msg.id ?? "",
    conversationId: msg.conversationId ?? "",
    subject: msg.subject ?? "(No Subject)",
    from: parseGraphAddress(msg.from),
    bodyPreview: msg.bodyPreview ?? "",
    date: msg.receivedDateTime ?? "",
    isRead: msg.isRead ?? false,
    hasAttachments: msg.hasAttachments ?? false,
    importance: (msg.importance as EmailSummary["importance"]) ?? "normal",
  };
}

function toEmailMessage(msg: GraphMessage): EmailMessage {
  const bodyContent = msg.body?.content ?? "";
  const isHtml = msg.body?.contentType === "html" || msg.body?.contentType === "HTML";

  return {
    id: msg.id ?? "",
    conversationId: msg.conversationId ?? "",
    subject: msg.subject ?? "(No Subject)",
    from: parseGraphAddress(msg.from),
    to: parseGraphAddressList(msg.toRecipients),
    cc: parseGraphAddressList(msg.ccRecipients),
    bcc: parseGraphAddressList(msg.bccRecipients),
    date: msg.receivedDateTime ?? "",
    body: {
      text: isHtml ? undefined : bodyContent,
      html: isHtml ? bodyContent : undefined,
    },
    bodyPreview: msg.bodyPreview ?? "",
    hasAttachments: msg.hasAttachments ?? false,
    isRead: msg.isRead ?? false,
    importance: (msg.importance as EmailMessage["importance"]) ?? "normal",
    parentFolderId: msg.parentFolderId ?? "",
  };
}

function toRecipients(addresses: string | string[]): Array<{ emailAddress: { address: string } }> {
  const list = Array.isArray(addresses) ? addresses : [addresses];
  return list.map((addr) => ({ emailAddress: { address: addr } }));
}

// ============ PUBLIC API ============

/**
 * List emails with optional filtering and search
 */
export async function listEmails(options: ListEmailsOptions = {}): Promise<ListEmailsResult> {
  const client = await getGraphClient();
  const { folderId, search, filter, top = 20, orderBy = "receivedDateTime desc" } = options;

  const basePath = folderId
    ? `/me/mailFolders/${folderId}/messages`
    : "/me/messages";

  let request = client
    .api(basePath)
    .select("id,conversationId,subject,from,bodyPreview,receivedDateTime,isRead,hasAttachments,importance")
    .top(top)
    .orderby(orderBy);

  if (filter) {
    request = request.filter(filter);
  }

  if (search) {
    request = request.search(`"${search}"`);
  }

  // Use immutable IDs so they don't change on folder moves
  request = request.header("Prefer", 'IdType="ImmutableId"');

  const response = await request.get();
  const messages: EmailSummary[] = (response.value ?? []).map(toEmailSummary);

  logger.info("Listed emails", { count: messages.length, folderId, search, filter });

  return {
    messages,
    nextLink: response["@odata.nextLink"] ?? undefined,
    totalCount: response["@odata.count"] ?? undefined,
  };
}

/**
 * Get a full email message by ID
 */
export async function getEmail(messageId: string): Promise<EmailMessage> {
  const client = await getGraphClient();

  const msg = await client
    .api(`/me/messages/${messageId}`)
    .header("Prefer", 'IdType="ImmutableId"')
    .get();

  logger.info("Got email", { messageId, subject: msg.subject });
  return toEmailMessage(msg);
}

/**
 * Send a new email
 */
export async function sendEmail(options: SendEmailOptions): Promise<{ sent: boolean }> {
  const client = await getGraphClient();

  const message: Record<string, unknown> = {
    subject: options.subject,
    body: {
      contentType: options.isHtml ? "HTML" : "Text",
      content: options.body,
    },
    toRecipients: toRecipients(options.to),
  };

  if (options.cc) {
    message.ccRecipients = toRecipients(options.cc);
  }

  if (options.bcc) {
    message.bccRecipients = toRecipients(options.bcc);
  }

  await client.api("/me/sendMail").post({
    message,
    saveToSentItems: options.saveToSentItems ?? true,
  });

  logger.info("Email sent", { to: options.to, subject: options.subject });
  return { sent: true };
}

/**
 * Reply to an existing email
 */
export async function replyToEmail(
  messageId: string,
  comment: string,
  isHtml?: boolean,
): Promise<{ sent: boolean }> {
  const client = await getGraphClient();

  await client.api(`/me/messages/${messageId}/reply`).post({
    comment,
    message: {
      body: {
        contentType: isHtml ? "HTML" : "Text",
        content: comment,
      },
    },
  });

  logger.info("Replied to email", { messageId });
  return { sent: true };
}

/**
 * Mark an email as read or unread
 */
export async function markRead(
  messageId: string,
  read: boolean
): Promise<{ marked: boolean }> {
  const client = await getGraphClient();

  await client.api(`/me/messages/${messageId}`).patch({
    isRead: read,
  });

  logger.info("Marked email", { messageId, read });
  return { marked: true };
}

/**
 * List mail folders
 */
export async function listFolders(): Promise<MailFolder[]> {
  const client = await getGraphClient();

  const response = await client
    .api("/me/mailFolders")
    .select("id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount,isHidden")
    .top(50)
    .get();

  interface GraphMailFolder {
    id?: string;
    displayName?: string;
    parentFolderId?: string;
    childFolderCount?: number;
    totalItemCount?: number;
    unreadItemCount?: number;
    isHidden?: boolean;
  }

  const folders: MailFolder[] = (response.value ?? []).map((f: GraphMailFolder) => ({
    id: f.id ?? "",
    displayName: f.displayName ?? "",
    parentFolderId: f.parentFolderId ?? undefined,
    childFolderCount: f.childFolderCount ?? 0,
    totalItemCount: f.totalItemCount ?? 0,
    unreadItemCount: f.unreadItemCount ?? 0,
    isHidden: f.isHidden ?? false,
  }));

  logger.info("Listed mail folders", { count: folders.length });
  return folders;
}
