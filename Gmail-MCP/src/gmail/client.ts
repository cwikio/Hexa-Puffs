import { google, gmail_v1 } from "googleapis";
import { getAuthenticatedClient } from "./auth.js";
import { logger } from "../utils/logger.js";
import type {
  EmailMessage,
  EmailSummary,
  EmailAddress,
  AttachmentInfo,
  Label,
  Draft,
  SendEmailOptions,
  ListEmailsOptions,
  ListEmailsResult,
  FilterCriteria,
  FilterAction,
  GmailFilter,
} from "../types/gmail.js";

let gmailClient: gmail_v1.Gmail | null = null;

/**
 * Get authenticated Gmail client
 */
export async function getGmailClient(): Promise<gmail_v1.Gmail> {
  if (!gmailClient) {
    const auth = await getAuthenticatedClient();
    gmailClient = google.gmail({ version: "v1", auth });
  }
  return gmailClient;
}

/**
 * Parse email address string into EmailAddress object
 */
function parseEmailAddress(addressStr: string): EmailAddress {
  // Format: "Name <email@example.com>" or "email@example.com"
  const match = addressStr.match(/^(?:"?([^"<]*)"?\s*)?<?([^>]+)>?$/);
  if (match) {
    return {
      email: match[2].trim(),
      name: match[1]?.trim() || undefined,
    };
  }
  return { email: addressStr.trim() };
}

/**
 * Parse header value containing multiple addresses
 */
function parseAddressList(headerValue: string | undefined): EmailAddress[] {
  if (!headerValue) return [];
  return headerValue.split(",").map((addr) => parseEmailAddress(addr.trim()));
}

/**
 * Get header value from message headers
 */
function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string | undefined {
  const header = headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase()
  );
  return header?.value ?? undefined;
}

/**
 * Decode base64url encoded string
 */
function decodeBase64Url(str: string): string {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

/**
 * Extract body from message parts
 */
function extractBody(
  payload: gmail_v1.Schema$MessagePart | undefined
): { text?: string; html?: string } {
  const result: { text?: string; html?: string } = {};

  if (!payload) return result;

  // Simple message with body
  if (payload.body?.data) {
    const content = decodeBase64Url(payload.body.data);
    if (payload.mimeType === "text/plain") {
      result.text = content;
    } else if (payload.mimeType === "text/html") {
      result.html = content;
    }
    return result;
  }

  // Multipart message
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data && !result.text) {
        result.text = decodeBase64Url(part.body.data);
      } else if (part.mimeType === "text/html" && part.body?.data && !result.html) {
        result.html = decodeBase64Url(part.body.data);
      } else if (part.mimeType?.startsWith("multipart/")) {
        // Recursively extract from nested multipart
        const nested = extractBody(part);
        if (nested.text && !result.text) result.text = nested.text;
        if (nested.html && !result.html) result.html = nested.html;
      }
    }
  }

  return result;
}

/**
 * Extract attachment info from message parts
 */
function extractAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined
): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];

  if (!payload) return attachments;

  function processPart(part: gmail_v1.Schema$MessagePart): void {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body.size ?? 0,
      });
    }

    if (part.parts) {
      part.parts.forEach(processPart);
    }
  }

  processPart(payload);
  return attachments;
}

/**
 * Convert Gmail message to EmailMessage
 */
function toEmailMessage(msg: gmail_v1.Schema$Message): EmailMessage {
  const headers = msg.payload?.headers;

  return {
    id: msg.id!,
    threadId: msg.threadId!,
    labelIds: msg.labelIds ?? [],
    snippet: msg.snippet ?? "",
    subject: getHeader(headers, "Subject") ?? "(No Subject)",
    from: parseEmailAddress(getHeader(headers, "From") ?? ""),
    to: parseAddressList(getHeader(headers, "To")),
    cc: parseAddressList(getHeader(headers, "Cc")) || undefined,
    bcc: parseAddressList(getHeader(headers, "Bcc")) || undefined,
    date: getHeader(headers, "Date") ?? "",
    body: extractBody(msg.payload),
    attachments: extractAttachments(msg.payload) || undefined,
    isUnread: msg.labelIds?.includes("UNREAD") ?? false,
  };
}

/**
 * Convert Gmail message to EmailSummary
 */
function toEmailSummary(msg: gmail_v1.Schema$Message): EmailSummary {
  const headers = msg.payload?.headers;

  return {
    id: msg.id!,
    threadId: msg.threadId!,
    subject: getHeader(headers, "Subject") ?? "(No Subject)",
    from: parseEmailAddress(getHeader(headers, "From") ?? ""),
    snippet: msg.snippet ?? "",
    date: getHeader(headers, "Date") ?? "",
    isUnread: msg.labelIds?.includes("UNREAD") ?? false,
    labelIds: msg.labelIds ?? [],
  };
}

/**
 * Create raw email for sending
 */
function createRawEmail(options: SendEmailOptions): string {
  const toAddresses = Array.isArray(options.to) ? options.to.join(", ") : options.to;
  const ccAddresses = options.cc
    ? Array.isArray(options.cc)
      ? options.cc.join(", ")
      : options.cc
    : undefined;
  const bccAddresses = options.bcc
    ? Array.isArray(options.bcc)
      ? options.bcc.join(", ")
      : options.bcc
    : undefined;

  const headers: string[] = [
    `To: ${toAddresses}`,
    `Subject: ${options.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: ${options.isHtml ? "text/html" : "text/plain"}; charset=utf-8`,
  ];

  if (ccAddresses) {
    headers.push(`Cc: ${ccAddresses}`);
  }
  if (bccAddresses) {
    headers.push(`Bcc: ${bccAddresses}`);
  }
  if (options.inReplyTo) {
    headers.push(`In-Reply-To: ${options.inReplyTo}`);
  }
  if (options.references) {
    headers.push(`References: ${options.references}`);
  }

  const raw = [...headers, "", options.body].join("\r\n");
  return Buffer.from(raw).toString("base64url");
}

// ============ PUBLIC API ============

/**
 * List emails with optional filters
 */
export async function listEmails(
  options: ListEmailsOptions = {}
): Promise<ListEmailsResult> {
  const gmail = await getGmailClient();

  const response = await gmail.users.messages.list({
    userId: "me",
    q: options.query,
    maxResults: options.maxResults ?? 20,
    labelIds: options.labelIds,
    pageToken: options.pageToken,
    includeSpamTrash: options.includeSpamTrash ?? false,
  });

  const messages: EmailSummary[] = [];

  if (response.data.messages) {
    // Fetch metadata for each message
    const fetchPromises = response.data.messages.map(async (m) => {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id: m.id!,
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date"],
      });
      return toEmailSummary(msg.data);
    });

    const fetched = await Promise.all(fetchPromises);
    messages.push(...fetched);
  }

  logger.debug("Listed emails", { count: messages.length, query: options.query });

  return {
    messages,
    nextPageToken: response.data.nextPageToken ?? undefined,
    resultSizeEstimate: response.data.resultSizeEstimate ?? 0,
  };
}

/**
 * Get a single email by ID with full content
 */
export async function getEmail(messageId: string): Promise<EmailMessage> {
  const gmail = await getGmailClient();

  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  logger.debug("Got email", { id: messageId });
  return toEmailMessage(response.data);
}

/**
 * Send an email
 */
export async function sendEmail(
  options: SendEmailOptions
): Promise<{ id: string; threadId: string }> {
  const gmail = await getGmailClient();

  const raw = createRawEmail(options);

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      threadId: options.threadId,
    },
  });

  logger.info("Sent email", { id: response.data.id, to: options.to });

  return {
    id: response.data.id!,
    threadId: response.data.threadId!,
  };
}

/**
 * Reply to an email thread
 */
export async function replyToEmail(
  messageId: string,
  body: string,
  isHtml = false
): Promise<{ id: string; threadId: string }> {
  const gmail = await getGmailClient();

  // Get original message for headers
  const original = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "metadata",
    metadataHeaders: ["From", "To", "Subject", "Message-ID", "References"],
  });

  const headers = original.data.payload?.headers;
  const from = getHeader(headers, "From");
  const subject = getHeader(headers, "Subject");
  const messageIdHeader = getHeader(headers, "Message-ID");
  const references = getHeader(headers, "References");

  // Build references chain
  const newReferences = references
    ? `${references} ${messageIdHeader}`
    : messageIdHeader ?? "";

  return sendEmail({
    to: from ?? "",
    subject: subject?.startsWith("Re:") ? subject : `Re: ${subject}`,
    body,
    isHtml,
    threadId: original.data.threadId ?? undefined,
    inReplyTo: messageIdHeader,
    references: newReferences,
  });
}

/**
 * Delete an email (move to trash)
 */
export async function trashEmail(messageId: string): Promise<void> {
  const gmail = await getGmailClient();

  await gmail.users.messages.trash({
    userId: "me",
    id: messageId,
  });

  logger.info("Trashed email", { id: messageId });
}

/**
 * Permanently delete an email
 */
export async function deleteEmail(messageId: string): Promise<void> {
  const gmail = await getGmailClient();

  await gmail.users.messages.delete({
    userId: "me",
    id: messageId,
  });

  logger.info("Deleted email", { id: messageId });
}

/**
 * Mark email as read/unread
 */
export async function markRead(
  messageId: string,
  read: boolean
): Promise<void> {
  const gmail = await getGmailClient();

  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds: read ? [] : ["UNREAD"],
      removeLabelIds: read ? ["UNREAD"] : [],
    },
  });

  logger.debug("Marked email", { id: messageId, read });
}

/**
 * Modify email labels
 */
export async function modifyLabels(
  messageId: string,
  addLabelIds: string[] = [],
  removeLabelIds: string[] = []
): Promise<void> {
  const gmail = await getGmailClient();

  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds,
      removeLabelIds,
    },
  });

  logger.debug("Modified labels", { id: messageId, addLabelIds, removeLabelIds });
}

// ============ LABELS ============

/**
 * List all labels
 */
export async function listLabels(): Promise<Label[]> {
  const gmail = await getGmailClient();

  const response = await gmail.users.labels.list({
    userId: "me",
  });

  const labels: Label[] = (response.data.labels ?? []).map((label) => ({
    id: label.id!,
    name: label.name!,
    type: label.type === "system" ? "system" : "user",
    messagesTotal: label.messagesTotal ?? undefined,
    messagesUnread: label.messagesUnread ?? undefined,
  }));

  logger.debug("Listed labels", { count: labels.length });
  return labels;
}

/**
 * Create a new label
 */
export async function createLabel(name: string): Promise<Label> {
  const gmail = await getGmailClient();

  const response = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });

  logger.info("Created label", { name, id: response.data.id });

  return {
    id: response.data.id!,
    name: response.data.name!,
    type: "user",
  };
}

/**
 * Delete a label
 */
export async function deleteLabel(labelId: string): Promise<void> {
  const gmail = await getGmailClient();

  await gmail.users.labels.delete({
    userId: "me",
    id: labelId,
  });

  logger.info("Deleted label", { id: labelId });
}

// ============ DRAFTS ============

/**
 * List all drafts
 */
export async function listDrafts(): Promise<Draft[]> {
  const gmail = await getGmailClient();

  const response = await gmail.users.drafts.list({
    userId: "me",
  });

  const drafts: Draft[] = [];

  if (response.data.drafts) {
    for (const d of response.data.drafts) {
      const draft = await gmail.users.drafts.get({
        userId: "me",
        id: d.id!,
        format: "metadata",
      });

      const headers = draft.data.message?.payload?.headers;

      drafts.push({
        id: d.id!,
        message: {
          id: draft.data.message?.id ?? "",
          threadId: draft.data.message?.threadId ?? "",
          subject: getHeader(headers, "Subject") ?? "(No Subject)",
          to: parseAddressList(getHeader(headers, "To")),
          snippet: draft.data.message?.snippet ?? "",
        },
      });
    }
  }

  logger.debug("Listed drafts", { count: drafts.length });
  return drafts;
}

/**
 * Create a new draft
 */
export async function createDraft(
  options: SendEmailOptions
): Promise<{ id: string; messageId: string }> {
  const gmail = await getGmailClient();

  const raw = createRawEmail(options);

  const response = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: { raw },
    },
  });

  logger.info("Created draft", { id: response.data.id });

  return {
    id: response.data.id!,
    messageId: response.data.message?.id!,
  };
}

/**
 * Update an existing draft
 */
export async function updateDraft(
  draftId: string,
  options: SendEmailOptions
): Promise<{ id: string; messageId: string }> {
  const gmail = await getGmailClient();

  const raw = createRawEmail(options);

  const response = await gmail.users.drafts.update({
    userId: "me",
    id: draftId,
    requestBody: {
      message: { raw },
    },
  });

  logger.info("Updated draft", { id: response.data.id });

  return {
    id: response.data.id!,
    messageId: response.data.message?.id!,
  };
}

/**
 * Send a draft
 */
export async function sendDraft(
  draftId: string
): Promise<{ id: string; threadId: string }> {
  const gmail = await getGmailClient();

  const response = await gmail.users.drafts.send({
    userId: "me",
    requestBody: { id: draftId },
  });

  logger.info("Sent draft", { id: response.data.id });

  return {
    id: response.data.id!,
    threadId: response.data.threadId!,
  };
}

/**
 * Delete a draft
 */
export async function deleteDraft(draftId: string): Promise<void> {
  const gmail = await getGmailClient();

  await gmail.users.drafts.delete({
    userId: "me",
    id: draftId,
  });

  logger.info("Deleted draft", { id: draftId });
}

// ============ ATTACHMENTS ============

/**
 * Get attachment data
 */
export async function getAttachment(
  messageId: string,
  attachmentId: string
): Promise<{ data: string; size: number }> {
  const gmail = await getGmailClient();

  const response = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  });

  logger.debug("Got attachment", { messageId, attachmentId });

  return {
    data: response.data.data ?? "",
    size: response.data.size ?? 0,
  };
}

/**
 * List attachments for a message
 */
export async function listAttachments(messageId: string): Promise<AttachmentInfo[]> {
  const email = await getEmail(messageId);
  return email.attachments ?? [];
}

// ============ HISTORY (for polling) ============

/**
 * Get user profile (for history ID)
 */
export async function getProfile(): Promise<{
  emailAddress: string;
  historyId: string;
}> {
  const gmail = await getGmailClient();

  const response = await gmail.users.getProfile({
    userId: "me",
  });

  return {
    emailAddress: response.data.emailAddress!,
    historyId: response.data.historyId!,
  };
}

/**
 * Get history changes since a given history ID
 */
export async function getHistory(
  startHistoryId: string,
  historyTypes: Array<"messageAdded" | "messageDeleted" | "labelAdded" | "labelRemoved"> = [
    "messageAdded",
  ]
): Promise<{
  historyId: string;
  messages: Array<{ id: string; action: string }>;
}> {
  const gmail = await getGmailClient();

  const response = await gmail.users.history.list({
    userId: "me",
    startHistoryId,
    historyTypes,
    labelId: "INBOX",
  });

  const messages: Array<{ id: string; action: string }> = [];

  if (response.data.history) {
    for (const h of response.data.history) {
      if (h.messagesAdded) {
        for (const m of h.messagesAdded) {
          messages.push({ id: m.message?.id!, action: "added" });
        }
      }
      if (h.messagesDeleted) {
        for (const m of h.messagesDeleted) {
          messages.push({ id: m.message?.id!, action: "deleted" });
        }
      }
    }
  }

  return {
    historyId: response.data.historyId ?? startHistoryId,
    messages,
  };
}

// ============ FILTERS ============

/**
 * List all Gmail filters
 */
export async function listFilters(): Promise<GmailFilter[]> {
  const gmail = await getGmailClient();

  const response = await gmail.users.settings.filters.list({
    userId: "me",
  });

  const filters: GmailFilter[] = (response.data.filter ?? []).map((f) => ({
    id: f.id!,
    criteria: {
      from: f.criteria?.from ?? undefined,
      to: f.criteria?.to ?? undefined,
      subject: f.criteria?.subject ?? undefined,
      query: f.criteria?.query ?? undefined,
      hasAttachment: f.criteria?.hasAttachment ?? undefined,
      size: f.criteria?.size ?? undefined,
      sizeComparison: (f.criteria?.sizeComparison as "larger" | "smaller") ?? undefined,
    },
    action: {
      addLabelIds: f.action?.addLabelIds ?? undefined,
      removeLabelIds: f.action?.removeLabelIds ?? undefined,
      forward: f.action?.forward ?? undefined,
    },
  }));

  logger.debug("Listed filters", { count: filters.length });
  return filters;
}

/**
 * Get a specific Gmail filter
 */
export async function getFilter(filterId: string): Promise<GmailFilter> {
  const gmail = await getGmailClient();

  const response = await gmail.users.settings.filters.get({
    userId: "me",
    id: filterId,
  });

  const f = response.data;

  logger.debug("Got filter", { id: filterId });

  return {
    id: f.id!,
    criteria: {
      from: f.criteria?.from ?? undefined,
      to: f.criteria?.to ?? undefined,
      subject: f.criteria?.subject ?? undefined,
      query: f.criteria?.query ?? undefined,
      hasAttachment: f.criteria?.hasAttachment ?? undefined,
      size: f.criteria?.size ?? undefined,
      sizeComparison: (f.criteria?.sizeComparison as "larger" | "smaller") ?? undefined,
    },
    action: {
      addLabelIds: f.action?.addLabelIds ?? undefined,
      removeLabelIds: f.action?.removeLabelIds ?? undefined,
      forward: f.action?.forward ?? undefined,
    },
  };
}

/**
 * Create a new Gmail filter
 */
export async function createFilter(
  criteria: FilterCriteria,
  action: FilterAction
): Promise<GmailFilter> {
  const gmail = await getGmailClient();

  const response = await gmail.users.settings.filters.create({
    userId: "me",
    requestBody: {
      criteria: {
        from: criteria.from,
        to: criteria.to,
        subject: criteria.subject,
        query: criteria.query,
        hasAttachment: criteria.hasAttachment,
        size: criteria.size,
        sizeComparison: criteria.sizeComparison,
      },
      action: {
        addLabelIds: action.addLabelIds,
        removeLabelIds: action.removeLabelIds,
        forward: action.forward,
      },
    },
  });

  const f = response.data;

  logger.info("Created filter", { id: f.id });

  return {
    id: f.id!,
    criteria: {
      from: f.criteria?.from ?? undefined,
      to: f.criteria?.to ?? undefined,
      subject: f.criteria?.subject ?? undefined,
      query: f.criteria?.query ?? undefined,
      hasAttachment: f.criteria?.hasAttachment ?? undefined,
      size: f.criteria?.size ?? undefined,
      sizeComparison: (f.criteria?.sizeComparison as "larger" | "smaller") ?? undefined,
    },
    action: {
      addLabelIds: f.action?.addLabelIds ?? undefined,
      removeLabelIds: f.action?.removeLabelIds ?? undefined,
      forward: f.action?.forward ?? undefined,
    },
  };
}

/**
 * Delete a Gmail filter
 */
export async function deleteFilter(filterId: string): Promise<void> {
  const gmail = await getGmailClient();

  await gmail.users.settings.filters.delete({
    userId: "me",
    id: filterId,
  });

  logger.info("Deleted filter", { id: filterId });
}
