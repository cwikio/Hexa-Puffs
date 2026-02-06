import { z } from "zod";
import {
  listFilters,
  getFilter,
  createFilter,
  deleteFilter,
} from "../gmail/client.js";
import { logger } from "../utils/logger.js";
import {
  type StandardResponse,
  createSuccess,
  createError,
} from "@mcp/shared/Types/StandardResponse.js";
import type { GmailFilter } from "../types/gmail.js";

// ============ LIST FILTERS ============

export const listFiltersTool = {
  name: "list_filters",
  description: "List all Gmail filters/rules",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [] as string[],
  },
};

export const ListFiltersInputSchema = z.object({});

export async function handleListFilters(): Promise<
  StandardResponse<{ filters: GmailFilter[] }>
> {
  try {
    const filters = await listFilters();
    return createSuccess({ filters });
  } catch (error) {
    logger.error("Failed to list filters", { error });
    return createError(
      `Failed to list filters: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ GET FILTER ============

export const getFilterTool = {
  name: "get_filter",
  description: "Get a specific Gmail filter by ID",
  inputSchema: {
    type: "object" as const,
    properties: {
      filter_id: {
        type: "string",
        description: "The ID of the filter to retrieve",
      },
    },
    required: ["filter_id"],
  },
};

export const GetFilterInputSchema = z.object({
  filter_id: z.string().min(1),
});

export async function handleGetFilter(
  args: unknown
): Promise<StandardResponse<{ filter: GmailFilter }>> {
  const parseResult = GetFilterInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  try {
    const filter = await getFilter(parseResult.data.filter_id);
    return createSuccess({ filter });
  } catch (error) {
    logger.error("Failed to get filter", { error });
    return createError(
      `Failed to get filter: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ CREATE FILTER ============

export const createFilterTool = {
  name: "create_filter",
  description:
    "Create a new Gmail filter/rule. Criteria defines which emails match, action defines what happens to them.",
  inputSchema: {
    type: "object" as const,
    properties: {
      criteria: {
        type: "object",
        description: "Filter criteria (which emails to match)",
        properties: {
          from: { type: "string", description: "Sender email or pattern" },
          to: { type: "string", description: "Recipient email or pattern" },
          subject: { type: "string", description: "Subject contains" },
          query: {
            type: "string",
            description: "Gmail search query syntax",
          },
          has_attachment: {
            type: "boolean",
            description: "Only emails with attachments",
          },
          size: {
            type: "number",
            description: "Size threshold in bytes",
          },
          size_comparison: {
            type: "string",
            enum: ["larger", "smaller"],
            description: "Whether to match larger or smaller than size",
          },
        },
      },
      action: {
        type: "object",
        description: "What to do with matching emails",
        properties: {
          add_label_ids: {
            type: "array",
            items: { type: "string" },
            description: "Label IDs to add",
          },
          remove_label_ids: {
            type: "array",
            items: { type: "string" },
            description: "Label IDs to remove",
          },
          forward: {
            type: "string",
            description: "Email address to forward to",
          },
        },
      },
    },
    required: ["criteria", "action"],
  },
};

export const CreateFilterInputSchema = z.object({
  criteria: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    subject: z.string().optional(),
    query: z.string().optional(),
    has_attachment: z.boolean().optional(),
    size: z.coerce.number().optional(),
    size_comparison: z.enum(["larger", "smaller"]).optional(),
  }),
  action: z.object({
    add_label_ids: z.array(z.string()).optional(),
    remove_label_ids: z.array(z.string()).optional(),
    forward: z.string().optional(),
  }),
});

export async function handleCreateFilter(
  args: unknown
): Promise<StandardResponse<{ filter: GmailFilter }>> {
  const parseResult = CreateFilterInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  const { criteria: c, action: a } = parseResult.data;

  try {
    const filter = await createFilter(
      {
        from: c.from,
        to: c.to,
        subject: c.subject,
        query: c.query,
        hasAttachment: c.has_attachment,
        size: c.size,
        sizeComparison: c.size_comparison,
      },
      {
        addLabelIds: a.add_label_ids,
        removeLabelIds: a.remove_label_ids,
        forward: a.forward,
      }
    );

    return createSuccess({ filter });
  } catch (error) {
    logger.error("Failed to create filter", { error });
    return createError(
      `Failed to create filter: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// ============ DELETE FILTER ============

export const deleteFilterTool = {
  name: "delete_filter",
  description: "Delete a Gmail filter by ID",
  inputSchema: {
    type: "object" as const,
    properties: {
      filter_id: {
        type: "string",
        description: "The ID of the filter to delete",
      },
    },
    required: ["filter_id"],
  },
};

export const DeleteFilterInputSchema = z.object({
  filter_id: z.string().min(1),
});

export async function handleDeleteFilter(
  args: unknown
): Promise<StandardResponse<{ deleted: boolean }>> {
  const parseResult = DeleteFilterInputSchema.safeParse(args);

  if (!parseResult.success) {
    return createError(`Invalid input: ${parseResult.error.message}`);
  }

  try {
    await deleteFilter(parseResult.data.filter_id);
    return createSuccess({ deleted: true });
  } catch (error) {
    logger.error("Failed to delete filter", { error });
    return createError(
      `Failed to delete filter: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
