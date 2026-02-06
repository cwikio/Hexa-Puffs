import { z } from "zod";
import { listVaults, OpClientError } from "../op/client.js";
import type { ListVaultsResponse, VaultListItem } from "./types.js";

export const listVaultsSchema = z.object({});

export type ListVaultsInput = z.infer<typeof listVaultsSchema>;

export async function handleListVaults(
  _input: ListVaultsInput
): Promise<ListVaultsResponse> {
  try {
    const vaults = await listVaults();
    const data: VaultListItem[] = vaults.map((v) => ({
      id: v.id,
      name: v.name,
    }));

    return {
      success: true,
      data,
    };
  } catch (error) {
    if (error instanceof OpClientError) {
      return {
        success: false,
        error: `Error listing vaults: ${error.message}`,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
