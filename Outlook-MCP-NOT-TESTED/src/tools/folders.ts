import { z } from "zod";
import { listFolders } from "../outlook/client.js";
import { logger } from "../utils/logger.js";
import {
  type StandardResponse,
  createSuccess,
  createError,
} from "@mcp/shared/Types/StandardResponse.js";
import type { MailFolder } from "../types/outlook.js";

// ============ LIST FOLDERS ============

export const listFoldersTool = {
  name: "list_folders",
  description:
    "List mail folders in Outlook (Inbox, Sent Items, Drafts, etc.). Returns folder name, ID, total items, and unread count.",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [] as string[],
  },
};

export const ListFoldersInputSchema = z.object({});

export async function handleListFolders(
  _args?: unknown
): Promise<StandardResponse<MailFolder[]>> {
  try {
    const folders = await listFolders();
    return createSuccess(folders);
  } catch (error) {
    logger.error("Failed to list folders", { error });
    return createError(
      `Failed to list folders: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
