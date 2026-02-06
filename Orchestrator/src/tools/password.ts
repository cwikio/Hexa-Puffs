import { z } from 'zod';
import { getOrchestrator } from '../core/orchestrator.js';
import type { StandardResponse } from '../../../Shared/Types/StandardResponse.js';

export const passwordToolDefinition = {
  name: 'get_credential',
  description: 'Retrieve a credential from 1Password. The item name will be security-scanned. For security, raw credentials are not returned in responses.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      item_name: {
        type: 'string',
        description: 'The name of the 1Password item to retrieve',
      },
      vault: {
        type: 'string',
        description: 'Optional vault name. If not provided, searches all vaults.',
      },
    },
    required: ['item_name'],
  },
};

const PasswordInputSchema = z.object({
  item_name: z.string().min(1),
  vault: z.string().optional(),
});

export async function handlePassword(args: unknown): Promise<StandardResponse> {
  const parseResult = PasswordInputSchema.safeParse(args);

  if (!parseResult.success) {
    return {
      success: false,
      error: 'Invalid input: ' + parseResult.error.message,
    };
  }

  const { item_name, vault } = parseResult.data;

  try {
    const orchestrator = await getOrchestrator();
    const result = await orchestrator.getPassword(item_name, vault);

    if (result.found) {
      // For security, we don't return the actual credential values
      // Instead, we confirm the item was found and can be used
      return {
        success: true,
        data: {
          found: true,
          message: `Credential "${item_name}" found and available for use.`,
          note: 'For security, credential values are not displayed. They can be used directly in operations that need them.',
        },
      };
    } else {
      return {
        success: false,
        error: result.error || `Item "${item_name}" not found`,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
