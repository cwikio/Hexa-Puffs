import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool } from "@mcp/shared/Utils/register-tool.js";
import {
  listVaultsSchema,
  handleListVaults,
  listItemsSchema,
  handleListItems,
  getItemSchema,
  handleGetItem,
  readSecretSchema,
  handleReadSecret,
} from "./tools/index.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "1password",
    version: "1.0.0",
  });

  registerTool(server, {
    name: "list_vaults",
    description:
      "List all accessible 1Password vaults. Use this first to discover vault IDs before listing items or reading secrets.\n\nReturns: [{ id, name }]",
    inputSchema: listVaultsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => handleListVaults(params),
  });

  registerTool(server, {
    name: "list_items",
    description:
      "List items in a 1Password vault. Use to discover passwords, API keys, credit cards, and other stored items.\n\nArgs:\n  - vault (string): Vault name or ID\n  - categories (string[], optional): Filter by category (e.g., ['LOGIN', 'API_CREDENTIAL', 'CREDIT_CARD'])\n\nReturns: [{ id, title, category, last_edited_by, updated_at, version }]",
    inputSchema: listItemsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => handleListItems(params),
  });

  registerTool(server, {
    name: "get_item",
    description:
      "Get full details of a 1Password item including all fields. Returns field values and secret references (op:// URIs) for use with read_secret.\n\nArgs:\n  - item (string): Item name or ID\n  - vault (string, optional): Vault name or ID (searches all vaults if omitted)\n\nReturns: { id, title, category, fields: [{ id, type, label, value, reference }], urls, tags, updated_at }",
    inputSchema: getItemSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => handleGetItem(params),
  });

  registerTool(server, {
    name: "read_secret",
    description:
      "Read a secret value using a 1Password secret reference URI. Use to retrieve passwords, API keys, and tokens. Get references from get_item response.\n\nArgs:\n  - reference (string): Secret reference URI (e.g., 'op://Private/GitHub/password')\n\nReturns: The secret value as a string",
    inputSchema: readSecretSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => handleReadSecret(params),
  });

  return server;
}
