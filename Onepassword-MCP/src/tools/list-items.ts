import { z } from "zod";
import { listItems, OpClientError } from "../op/client.js";
import type { ListItemsResponse, ItemListItem } from "./types.js";

export const listItemsSchema = z.object({
  vault: z.string().describe("Vault name or ID. Use the vault name (e.g., 'Private') or ID from list_vaults response."),
  categories: z
    .array(z.string())
    .optional()
    .describe(
      "Optional array to filter by item categories. Common categories: 'Login', 'Password', 'API Credential', 'Server', 'Database', 'SecureNote', 'CreditCard', 'Identity', 'Document'. Leave empty to list all items."
    ),
});

export type ListItemsInput = z.infer<typeof listItemsSchema>;

export async function handleListItems(
  input: ListItemsInput
): Promise<ListItemsResponse> {
  try {
    const items = await listItems(input.vault, input.categories);
    const data: ItemListItem[] = items.map((item) => ({
      id: item.id,
      title: item.title,
      category: item.category,
      vault: item.vault.name,
      updated_at: item.updated_at,
    }));

    return {
      success: true,
      data,
    };
  } catch (error) {
    if (error instanceof OpClientError) {
      return {
        success: false,
        error: `Error listing items: ${error.message}`,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
