import { z } from "zod";
import { readSecret, OpClientError } from "../op/client.js";
import type { ReadSecretResponse } from "./types.js";

export const readSecretSchema = z.object({
  reference: z
    .string()
    .describe("1Password secret reference URI in the format 'op://vault-name/item-name/field-name'. The reference path can be obtained from field.reference in the get_item response. Examples: 'op://Private/GitHub/password', 'op://Work/AWS/credential', 'op://Personal/Gmail/username'"),
});

export type ReadSecretInput = z.infer<typeof readSecretSchema>;

export async function handleReadSecret(
  input: ReadSecretInput
): Promise<ReadSecretResponse> {
  try {
    const secret = await readSecret(input.reference);
    return {
      success: true,
      data: secret,
    };
  } catch (error) {
    if (error instanceof OpClientError) {
      return {
        success: false,
        error: `Error reading secret: ${error.message}`,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
