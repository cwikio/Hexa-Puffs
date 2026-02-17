import { z } from "zod";
import { listLabels, createLabel, deleteLabel } from "../gmail/client.js";
import { logger } from "../utils/logger.js";
import {
  type StandardResponse,
  createSuccess,
  createError,
} from "@mcp/shared/Types/StandardResponse.js";
import type { Label } from "../types/gmail.js";

// ============ LIST LABELS ============

export const listLabelsTool = {
  name: "list_labels",
  description: "List all Gmail labels (both system and user-created)",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};

export const ListLabelsInputSchema = z.object({});

export async function handleListLabels(): Promise<StandardResponse<Label[]>> {
  try {
    const labels = await listLabels();
    return createSuccess(labels);
  } catch (error) {
    logger.error("Failed to list labels", { error });
    return createError(
      `Failed to list labels: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ CREATE LABEL ============

export const createLabelTool = {
  name: "create_label",
  description: "Create a new Gmail label",
  inputSchema: {
    type: "object" as const,
    properties: {
      name: {
        type: "string",
        description: "Name for the new label",
      },
    },
    required: ["name"],
  },
};

export const CreateLabelInputSchema = z.object({
  name: z.string().min(1),
});

export async function handleCreateLabel(
  args: unknown
): Promise<StandardResponse<Label>> {
  const parseResult = CreateLabelInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  try {
    const label = await createLabel(parseResult.data.name);
    return createSuccess(label);
  } catch (error) {
    logger.error("Failed to create label", { error });
    return createError(
      `Failed to create label: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ DELETE LABEL ============

export const deleteLabelTool = {
  name: "delete_label",
  description: "Delete a Gmail label (only user-created labels can be deleted)",
  inputSchema: {
    type: "object" as const,
    properties: {
      label_id: {
        type: "string",
        description: "ID of the label to delete",
      },
    },
    required: ["label_id"],
  },
};

export const DeleteLabelInputSchema = z.object({
  label_id: z.string().min(1),
});

export async function handleDeleteLabel(
  args: unknown
): Promise<StandardResponse<{ deleted: boolean }>> {
  const parseResult = DeleteLabelInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  try {
    await deleteLabel(parseResult.data.label_id);
    return createSuccess({ deleted: true });
  } catch (error) {
    logger.error("Failed to delete label", { error });
    return createError(
      `Failed to delete label: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
