import { z } from "zod";
import { getItem, OpClientError } from "../op/client.js";
import type { GetItemResponse, ItemDetails } from "./types.js";

export const getItemSchema = z.object({
  item: z.string().describe("Item title or ID. Use the exact title (e.g., 'GitHub API Key') or the item ID from list_items response. Item IDs are more reliable for unique identification."),
  vault: z.string().optional().describe("Vault name or ID. Optional if the item ID is globally unique across all vaults. Required when using item title that might exist in multiple vaults."),
});

export type GetItemInput = z.infer<typeof getItemSchema>;

export async function handleGetItem(
  input: GetItemInput
): Promise<GetItemResponse> {
  try {
    const item = await getItem(input.item, input.vault);
    const data: ItemDetails = {
      id: item.id,
      title: item.title,
      category: item.category,
      vault: item.vault.name,
      fields: item.fields.map((f) => ({
        label: f.label,
        type: f.type,
        value: f.value,
        reference: f.reference,
      })),
      created_at: item.created_at,
      updated_at: item.updated_at,
    };

    return {
      success: true,
      data,
    };
  } catch (error) {
    if (error instanceof OpClientError) {
      return {
        success: false,
        error: `Error getting item: ${error.message}`,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
