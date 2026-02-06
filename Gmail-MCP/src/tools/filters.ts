import {
  listFilters,
  getFilter,
  createFilter,
  deleteFilter,
} from "../gmail/client.js";

// ============================================================================
// Tool Definitions
// ============================================================================

export const listFiltersTool = {
  name: "list_filters",
  description: "List all Gmail filters/rules",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [] as string[],
  },
};

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

// ============================================================================
// Handlers
// ============================================================================

export async function handleListFilters() {
  const filters = await listFilters();
  return { filters };
}

export async function handleGetFilter(args: unknown) {
  const { filter_id: filterId } = args as Record<string, unknown>;
  if (typeof filterId !== 'string') throw new Error("filter_id is required");
  const filter = await getFilter(filterId);
  return { filter };
}

export async function handleCreateFilter(args: unknown) {
  const { criteria, action } = args as Record<string, unknown>;

  if (!criteria || !action) {
    throw new Error("Both criteria and action are required");
  }

  const c = criteria as Record<string, unknown>;
  const a = action as Record<string, unknown>;

  const filter = await createFilter(
    {
      from: c.from as string | undefined,
      to: c.to as string | undefined,
      subject: c.subject as string | undefined,
      query: c.query as string | undefined,
      hasAttachment: c.has_attachment as boolean | undefined,
      size: c.size as number | undefined,
      sizeComparison: c.size_comparison as "larger" | "smaller" | undefined,
    },
    {
      addLabelIds: a.add_label_ids as string[] | undefined,
      removeLabelIds: a.remove_label_ids as string[] | undefined,
      forward: a.forward as string | undefined,
    }
  );

  return { filter };
}

export async function handleDeleteFilter(args: unknown) {
  const { filter_id: filterId } = args as Record<string, unknown>;
  if (typeof filterId !== 'string') throw new Error("filter_id is required");
  await deleteFilter(filterId);
  return { deleted: true };
}
