import { z } from "zod";
import {
  listDrafts,
  createDraft,
  updateDraft,
  sendDraft,
  deleteDraft,
} from "../gmail/client.js";
import { logger } from "../utils/logger.js";
import {
  type StandardResponse,
  createSuccess,
  createError,
} from "@mcp/shared/Types/StandardResponse.js";
import type { Draft } from "../types/gmail.js";

// ============ LIST DRAFTS ============

export const listDraftsTool = {
  name: "list_drafts",
  description: "List all email drafts",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};

export const ListDraftsInputSchema = z.object({});

export async function handleListDrafts(): Promise<StandardResponse<Draft[]>> {
  try {
    const drafts = await listDrafts();
    return createSuccess(drafts);
  } catch (error) {
    logger.error("Failed to list drafts", { error });
    return createError(
      `Failed to list drafts: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ CREATE DRAFT ============

export const createDraftTool = {
  name: "create_draft",
  description: "Create a new email draft",
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

export const CreateDraftInputSchema = z.object({
  to: z.string().min(1),
  subject: z.string(),
  body: z.string().min(1),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  is_html: z.boolean().optional(),
});

export async function handleCreateDraft(
  args: unknown
): Promise<StandardResponse<{ id: string; messageId: string }>> {
  const parseResult = CreateDraftInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  const { to, subject, body, cc, bcc, is_html } = parseResult.data;

  try {
    const result = await createDraft({
      to,
      subject,
      body,
      cc,
      bcc,
      isHtml: is_html,
    });

    return createSuccess(result);
  } catch (error) {
    logger.error("Failed to create draft", { error });
    return createError(
      `Failed to create draft: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ UPDATE DRAFT ============

export const updateDraftTool = {
  name: "update_draft",
  description: "Update an existing email draft",
  inputSchema: {
    type: "object" as const,
    properties: {
      draft_id: {
        type: "string",
        description: "ID of the draft to update",
      },
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
    required: ["draft_id", "to", "subject", "body"],
  },
};

export const UpdateDraftInputSchema = z.object({
  draft_id: z.string().min(1),
  to: z.string().min(1),
  subject: z.string(),
  body: z.string().min(1),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  is_html: z.boolean().optional(),
});

export async function handleUpdateDraft(
  args: unknown
): Promise<StandardResponse<{ id: string; messageId: string }>> {
  const parseResult = UpdateDraftInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  const { draft_id, to, subject, body, cc, bcc, is_html } = parseResult.data;

  try {
    const result = await updateDraft(draft_id, {
      to,
      subject,
      body,
      cc,
      bcc,
      isHtml: is_html,
    });

    return createSuccess(result);
  } catch (error) {
    logger.error("Failed to update draft", { error });
    return createError(
      `Failed to update draft: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ SEND DRAFT ============

export const sendDraftTool = {
  name: "send_draft",
  description: "Send an existing draft",
  inputSchema: {
    type: "object" as const,
    properties: {
      draft_id: {
        type: "string",
        description: "ID of the draft to send",
      },
    },
    required: ["draft_id"],
  },
};

export const SendDraftInputSchema = z.object({
  draft_id: z.string().min(1),
});

export async function handleSendDraft(
  args: unknown
): Promise<StandardResponse<{ id: string; threadId: string }>> {
  const parseResult = SendDraftInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  try {
    const result = await sendDraft(parseResult.data.draft_id);
    return createSuccess(result);
  } catch (error) {
    logger.error("Failed to send draft", { error });
    return createError(
      `Failed to send draft: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ DELETE DRAFT ============

export const deleteDraftTool = {
  name: "delete_draft",
  description: "Delete a draft",
  inputSchema: {
    type: "object" as const,
    properties: {
      draft_id: {
        type: "string",
        description: "ID of the draft to delete",
      },
    },
    required: ["draft_id"],
  },
};

export const DeleteDraftInputSchema = z.object({
  draft_id: z.string().min(1),
});

export async function handleDeleteDraft(
  args: unknown
): Promise<StandardResponse<{ deleted: boolean }>> {
  const parseResult = DeleteDraftInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  try {
    await deleteDraft(parseResult.data.draft_id);
    return createSuccess({ deleted: true });
  } catch (error) {
    logger.error("Failed to delete draft", { error });
    return createError(
      `Failed to delete draft: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
