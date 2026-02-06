import { z } from 'zod';
import { BaseMCPClient } from './base.js';
import { type MCPServerConfig } from '../config/index.js';

export interface CredentialResult {
  found: boolean;
  item?: {
    title: string;
    vault?: string;
    fields?: Record<string, string>;
  };
  error?: string;
}

const OnePasswordItemSchema = z.object({
  title: z.string().optional(),
  vault: z.string().optional(),
  fields: z.record(z.string()).optional(),
});

const VaultsListSchema = z.array(z.string());

export class OnePasswordMCPClient extends BaseMCPClient {
  constructor(config: MCPServerConfig) {
    super('onepassword', config);
  }

  async getItem(itemName: string, vault?: string): Promise<CredentialResult> {
    const args: Record<string, unknown> = { item_name: itemName };
    if (vault) {
      args.vault = vault;
    }

    const result = await this.callTool({
      name: 'get_item',
      arguments: args,
    });

    if (!result.success) {
      return {
        found: false,
        error: result.error,
      };
    }

    const parsed = this.parseTextResponse(result);
    if (parsed === null) {
      return {
        found: false,
        error: 'No content in response',
      };
    }

    const validated = OnePasswordItemSchema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn('Failed to validate 1Password result', { errors: validated.error.flatten() });
      return {
        found: false,
        error: 'Failed to parse response',
      };
    }

    return {
      found: true,
      item: {
        title: validated.data.title ?? itemName,
        vault: validated.data.vault,
        fields: validated.data.fields,
      },
    };
  }

  async listVaults(): Promise<string[]> {
    const result = await this.callTool({
      name: 'list_vaults',
      arguments: {},
    });

    if (!result.success) {
      return [];
    }

    const parsed = this.parseTextResponse(result);
    if (parsed === null) {
      return [];
    }

    const validated = VaultsListSchema.safeParse(parsed);
    if (!validated.success) {
      this.logger.warn('Failed to validate vaults list', { errors: validated.error.flatten() });
      return [];
    }

    return validated.data;
  }
}
