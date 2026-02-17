import { z } from "zod";
import {
  listEmails,
  getEmail,
  sendEmail,
  replyToEmail,
  markRead,
} from "../outlook/client.js";
import { logger } from "../utils/logger.js";
import {
  type StandardResponse,
  createSuccess,
  createError,
} from "@mcp/shared/Types/StandardResponse.js";
import type {
  EmailMessage,
  ListEmailsResult,
} from "../types/outlook.js";

// ============ LIST EMAILS ============

export const listEmailsTool = {
  name: "list_emails",
  description:
    "List emails from Outlook. Supports folder filtering, search queries, and OData filters. Returns email summaries with id, subject, sender, preview, and read status.",
  inputSchema: {
    type: "object" as const,
    properties: {
      folder_id: {
        type: "string",
        description:
          'Mail folder ID or well-known name: inbox, drafts, sentitems, deleteditems, junkemail, archive (default: all folders)',
      },
      search: {
        type: "string",
        description:
          "Free text search across subject, body, and sender",
      },
      filter: {
        type: "string",
        description:
          "OData filter expression (e.g., \"isRead eq false\", \"hasAttachments eq true\", \"importance eq 'high'\")",
      },
      max_results: {
        type: "number",
        description: "Maximum number of emails to return (default: 20, max: 50)",
      },
    },
    required: [] as string[],
  },
};

export const ListEmailsInputSchema = z.object({
  folder_id: z.string().optional(),
  search: z.string().optional(),
  filter: z.string().optional(),
  max_results: z.coerce.number().min(1).max(50).optional(),
});

export async function handleListEmails(
  args: unknown
): Promise<StandardResponse<ListEmailsResult>> {
  const parseResult = ListEmailsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  const { folder_id, search, filter, max_results } = parseResult.data;

  try {
    const result = await listEmails({
      folderId: folder_id,
      search,
      filter,
      top: max_results,
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
  description:
    "Get the full content of an email by its ID, including body, recipients, and attachment info. Use an id from list_emails results.",
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

  const { message_id } = parseResult.data;

  try {
    const email = await getEmail(message_id);
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
  description: "Send a new email via Outlook",
  inputSchema: {
    type: "object" as const,
    properties: {
      to: {
        type: "string",
        description: "Recipient email address (or comma-separated for multiple)",
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
        description: "CC email address (or comma-separated for multiple)",
      },
      bcc: {
        type: "string",
        description: "BCC email address (or comma-separated for multiple)",
      },
      is_html: {
        type: "boolean",
        description: "Whether the body is HTML (default: false, sends as plain text)",
      },
    },
    required: ["to", "subject", "body"],
  },
};

export const SendEmailInputSchema = z.object({
  to: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  is_html: z.boolean().optional(),
});

export async function handleSendEmail(
  args: unknown
): Promise<StandardResponse<{ sent: boolean }>> {
  const parseResult = SendEmailInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  const { to, subject, body, cc, bcc, is_html } = parseResult.data;

  const splitAddresses = (s: string) => s.split(",").map((a) => a.trim()).filter(Boolean);

  try {
    const result = await sendEmail({
      to: splitAddresses(to),
      subject,
      body,
      cc: cc ? splitAddresses(cc) : undefined,
      bcc: bcc ? splitAddresses(bcc) : undefined,
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
  description: "Reply to an existing email. Automatically handles threading and In-Reply-To headers.",
  inputSchema: {
    type: "object" as const,
    properties: {
      message_id: {
        type: "string",
        description: "The ID of the email to reply to",
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
): Promise<StandardResponse<{ sent: boolean }>> {
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

// ============ MARK READ ============

export const markReadTool = {
  name: "mark_read",
  description: "Mark an email as read or unread",
  inputSchema: {
    type: "object" as const,
    properties: {
      message_id: {
        type: "string",
        description: "The ID of the email",
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
    const result = await markRead(message_id, read);
    return createSuccess(result);
  } catch (error) {
    logger.error("Failed to mark email", { error });
    return createError(
      `Failed to mark email: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
