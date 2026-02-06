import { z } from "zod";
import {
  listEmails,
  getEmail,
  sendEmail,
  replyToEmail,
  trashEmail,
  markRead,
  modifyLabels,
  listLabels,
} from "../gmail/client.js";
import { getNewEmails, clearNewEmails } from "../gmail/polling.js";
import { logger } from "../utils/logger.js";
import {
  type StandardResponse,
  createSuccess,
  createError,
} from "@mcp/shared/Types/StandardResponse.js";
import type { EmailMessage, ListEmailsResult } from "../types/gmail.js";

// ============ LIST EMAILS ============

export const listEmailsTool = {
  name: "list_emails",
  description:
    "List emails from Gmail with optional search query. Supports Gmail search syntax: 'from:john@example.com', 'is:unread', 'subject:meeting', 'newer_than:2d', 'has:attachment'. Returns email IDs, subjects, and snippets. Use get_email with a message_id to read the full content.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description:
          'Gmail search query (e.g., "from:john@example.com", "is:unread", "subject:meeting")',
      },
      max_results: {
        type: "number",
        description: "Maximum number of emails to return (default: 20, max: 100)",
      },
      label_ids: {
        type: "array",
        items: { type: "string" },
        description: 'Filter by label IDs (e.g., ["INBOX", "UNREAD"])',
      },
      page_token: {
        type: "string",
        description: "Token for pagination to get next page of results",
      },
    },
    required: [],
  },
};

export const ListEmailsInputSchema = z.object({
  query: z.string().optional(),
  max_results: z.coerce.number().min(1).max(100).optional(),
  label_ids: z.array(z.string()).optional(),
  page_token: z.string().optional(),
});

export async function handleListEmails(
  args: unknown
): Promise<StandardResponse<ListEmailsResult>> {
  const parseResult = ListEmailsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  const { query, max_results, label_ids, page_token } = parseResult.data;

  try {
    const result = await listEmails({
      query,
      maxResults: max_results,
      labelIds: label_ids,
      pageToken: page_token,
    });

    return createSuccess(result);
  } catch (error) {
    logger.error("Failed to list emails", { error });
    return createError(
      `Failed to list emails: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ GET EMAIL ============

export const getEmailTool = {
  name: "get_email",
  description: "Get the full content of a specific email by its message ID (obtained from list_emails). Returns subject, body, sender, recipients, and attachments info.",
  inputSchema: {
    type: "object" as const,
    properties: {
      message_id: {
        type: "string",
        description: "The ID of the email to retrieve",
      },
    },
    required: ["message_id"],
  },
};

export const GetEmailInputSchema = z.object({
  message_id: z.string().min(1),
});

export async function handleGetEmail(
  args: unknown
): Promise<StandardResponse<EmailMessage>> {
  const parseResult = GetEmailInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  try {
    const email = await getEmail(parseResult.data.message_id);
    return createSuccess(email);
  } catch (error) {
    logger.error("Failed to get email", { error });
    return createError(
      `Failed to get email: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ SEND EMAIL ============

export const sendEmailTool = {
  name: "send_email",
  description: "Send a new email via Gmail. Use this for email — for Telegram messages use send_message instead. To reply to an existing thread, use reply_email instead of this.",
  inputSchema: {
    type: "object" as const,
    properties: {
      to: {
        type: "string",
        description: "Recipient email address (or comma-separated list)",
      },
      subject: {
        type: "string",
        description: "Email subject",
      },
      body: {
        type: "string",
        description: "Email body content",
      },
      cc: {
        type: "string",
        description: "CC recipients (comma-separated)",
      },
      bcc: {
        type: "string",
        description: "BCC recipients (comma-separated)",
      },
      is_html: {
        type: "boolean",
        description: "Whether the body is HTML (default: false)",
      },
    },
    required: ["to", "subject", "body"],
  },
};

export const SendEmailInputSchema = z.object({
  to: z.string().min(1),
  subject: z.string(),
  body: z.string().min(1),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  is_html: z.boolean().optional(),
});

export async function handleSendEmail(
  args: unknown
): Promise<StandardResponse<{ id: string; threadId: string }>> {
  const parseResult = SendEmailInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  const { to, subject, body, cc, bcc, is_html } = parseResult.data;

  try {
    const result = await sendEmail({
      to,
      subject,
      body,
      cc,
      bcc,
      isHtml: is_html,
    });

    return createSuccess(result);
  } catch (error) {
    logger.error("Failed to send email", { error });
    return createError(
      `Failed to send email: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ REPLY EMAIL ============

export const replyEmailTool = {
  name: "reply_email",
  description: "Reply to an existing email within the same thread. Use this instead of send_email when responding to a conversation. Requires the message_id from get_email or list_emails.",
  inputSchema: {
    type: "object" as const,
    properties: {
      message_id: {
        type: "string",
        description: "ID of the message to reply to",
      },
      body: {
        type: "string",
        description: "Reply body content",
      },
      is_html: {
        type: "boolean",
        description: "Whether the body is HTML (default: false)",
      },
    },
    required: ["message_id", "body"],
  },
};

export const ReplyEmailInputSchema = z.object({
  message_id: z.string().min(1),
  body: z.string().min(1),
  is_html: z.boolean().optional(),
});

export async function handleReplyEmail(
  args: unknown
): Promise<StandardResponse<{ id: string; threadId: string }>> {
  const parseResult = ReplyEmailInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  const { message_id, body, is_html } = parseResult.data;

  try {
    const result = await replyToEmail(message_id, body, is_html);
    return createSuccess(result);
  } catch (error) {
    logger.error("Failed to reply to email", { error });
    return createError(
      `Failed to reply to email: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ DELETE EMAIL ============

export const deleteEmailTool = {
  name: "delete_email",
  description: "Move an email to trash",
  inputSchema: {
    type: "object" as const,
    properties: {
      message_id: {
        type: "string",
        description: "ID of the message to delete",
      },
    },
    required: ["message_id"],
  },
};

export const DeleteEmailInputSchema = z.object({
  message_id: z.string().min(1),
});

export async function handleDeleteEmail(
  args: unknown
): Promise<StandardResponse<{ deleted: boolean }>> {
  const parseResult = DeleteEmailInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  try {
    await trashEmail(parseResult.data.message_id);
    return createSuccess({ deleted: true });
  } catch (error) {
    logger.error("Failed to delete email", { error });
    return createError(
      `Failed to delete email: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ MARK READ ============

export const markReadTool = {
  name: "mark_read",
  description: "Mark an email as read or unread",
  inputSchema: {
    type: "object" as const,
    properties: {
      message_id: {
        type: "string",
        description: "ID of the message",
      },
      read: {
        type: "boolean",
        description: "true to mark as read, false to mark as unread",
      },
    },
    required: ["message_id", "read"],
  },
};

export const MarkReadInputSchema = z.object({
  message_id: z.string().min(1),
  read: z.boolean(),
});

export async function handleMarkRead(
  args: unknown
): Promise<StandardResponse<{ marked: boolean }>> {
  const parseResult = MarkReadInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  const { message_id, read } = parseResult.data;

  try {
    await markRead(message_id, read);
    return createSuccess({ marked: true });
  } catch (error) {
    logger.error("Failed to mark email", { error });
    return createError(
      `Failed to mark email: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ MODIFY LABELS ============

export const modifyLabelsTool = {
  name: "modify_labels",
  description: "Add or remove labels from an email. Accepts label IDs (e.g. 'CATEGORY_SOCIAL', 'Label_123') or label names (e.g. 'Work', 'Personal') — names are automatically resolved to IDs.",
  inputSchema: {
    type: "object" as const,
    properties: {
      message_id: {
        type: "string",
        description: "ID of the message",
      },
      add_label_ids: {
        type: "array",
        items: { type: "string" },
        description: "Label IDs or names to add",
      },
      remove_label_ids: {
        type: "array",
        items: { type: "string" },
        description: "Label IDs or names to remove",
      },
    },
    required: ["message_id"],
  },
};

export const ModifyLabelsInputSchema = z.object({
  message_id: z.string().min(1),
  add_label_ids: z.array(z.string()).optional(),
  remove_label_ids: z.array(z.string()).optional(),
});

/**
 * Resolve an array of label IDs or names to actual Gmail label IDs.
 * If a value matches an existing label ID, it's used as-is.
 * Otherwise, it's matched by name (case-insensitive).
 * Unresolved values are returned as errors.
 */
function resolveLabelValues(
  values: string[] | undefined,
  idSet: Set<string>,
  nameToId: Map<string, string>
): { resolved: string[]; errors: string[] } {
  if (!values || values.length === 0) return { resolved: [], errors: [] };

  const resolved: string[] = [];
  const errors: string[] = [];

  for (const val of values) {
    if (idSet.has(val)) {
      resolved.push(val);
    } else {
      const id = nameToId.get(val.toLowerCase());
      if (id) {
        resolved.push(id);
      } else {
        errors.push(val);
      }
    }
  }

  return { resolved, errors };
}

export async function handleModifyLabels(
  args: unknown
): Promise<StandardResponse<{ modified: boolean }>> {
  const parseResult = ModifyLabelsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  const { message_id, add_label_ids, remove_label_ids } = parseResult.data;

  try {
    const labels = await listLabels();
    const idSet = new Set(labels.map((l) => l.id));
    const nameToId = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));

    const addResult = resolveLabelValues(add_label_ids, idSet, nameToId);
    const removeResult = resolveLabelValues(remove_label_ids, idSet, nameToId);

    const allErrors = [...addResult.errors, ...removeResult.errors];
    if (allErrors.length > 0) {
      return createError(
        `Unknown labels (not found by ID or name): ${allErrors.join(", ")}. Use list_labels to see available labels, or create_label to create new ones.`
      );
    }

    await modifyLabels(message_id, addResult.resolved, removeResult.resolved);
    return createSuccess({ modified: true });
  } catch (error) {
    logger.error("Failed to modify labels", { error });
    return createError(
      `Failed to modify labels: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ GET NEW EMAILS (from polling queue) ============

export const getNewEmailsTool = {
  name: "get_new_emails",
  description:
    "Get emails that have arrived since the last poll (requires polling to be enabled). Returns from an in-memory queue.",
  inputSchema: {
    type: "object" as const,
    properties: {
      clear: {
        type: "boolean",
        description: "Clear the queue after reading (default: false)",
      },
    },
    required: [],
  },
};

export const GetNewEmailsInputSchema = z.object({
  clear: z.union([z.boolean(), z.string()]).optional(),
});

export async function handleGetNewEmails(
  args: unknown
): Promise<StandardResponse<{ emails: EmailMessage[]; count: number }>> {
  const parseResult = GetNewEmailsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  const emails = getNewEmails();
  const count = emails.length;

  const clear = parseResult.data.clear === true || parseResult.data.clear === 'true';
  if (clear) {
    clearNewEmails();
  }

  return createSuccess({ emails, count });
}
