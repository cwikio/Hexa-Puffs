import { z } from "zod";
import { getAttachment, listAttachments } from "../gmail/client.js";
import { logger } from "../utils/logger.js";
import {
  type StandardResponse,
  createSuccess,
  createError,
} from "@mcp/shared/Types/StandardResponse.js";
import type { AttachmentInfo } from "../types/gmail.js";

// ============ LIST ATTACHMENTS ============

export const listAttachmentsTool = {
  name: "list_attachments",
  description: "List all attachments for a specific email",
  inputSchema: {
    type: "object" as const,
    properties: {
      message_id: {
        type: "string",
        description: "ID of the message to list attachments for",
      },
    },
    required: ["message_id"],
  },
};

export const ListAttachmentsInputSchema = z.object({
  message_id: z.string().min(1),
});

export async function handleListAttachments(
  args: unknown
): Promise<StandardResponse<AttachmentInfo[]>> {
  const parseResult = ListAttachmentsInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  try {
    const attachments = await listAttachments(parseResult.data.message_id);
    return createSuccess(attachments);
  } catch (error) {
    logger.error("Failed to list attachments", { error });
    return createError(
      `Failed to list attachments: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ GET ATTACHMENT ============

export const getAttachmentTool = {
  name: "get_attachment",
  description: "Download an attachment (returns base64-encoded data)",
  inputSchema: {
    type: "object" as const,
    properties: {
      message_id: {
        type: "string",
        description: "ID of the message containing the attachment",
      },
      attachment_id: {
        type: "string",
        description: "ID of the attachment to download",
      },
    },
    required: ["message_id", "attachment_id"],
  },
};

export const GetAttachmentInputSchema = z.object({
  message_id: z.string().min(1),
  attachment_id: z.string().min(1),
});

export async function handleGetAttachment(
  args: unknown
): Promise<StandardResponse<{ data: string; size: number }>> {
  const parseResult = GetAttachmentInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  const { message_id, attachment_id } = parseResult.data;

  try {
    const attachment = await getAttachment(message_id, attachment_id);
    return createSuccess(attachment);
  } catch (error) {
    logger.error("Failed to get attachment", { error });
    return createError(
      `Failed to get attachment: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
