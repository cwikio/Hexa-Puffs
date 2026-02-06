import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTool } from "@mcp/shared/Utils/register-tool.js";
import {
  listVaultsSchema,
  handleListVaults,
  type ListVaultsInput,
  listItemsSchema,
  handleListItems,
  type ListItemsInput,
  getItemSchema,
  handleGetItem,
  type GetItemInput,
  readSecretSchema,
  handleReadSecret,
  type ReadSecretInput,
} from "./tools/index.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "1password",
    version: "1.0.0",
  });

  registerTool(server, {
    name: "list_vaults",
    description:
      "List all accessible 1Password vaults. Use this as the first step to discover available vaults before listing items or retrieving secrets. Returns vault IDs and names.",
    inputSchema: listVaultsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => handleListVaults(params as ListVaultsInput),
  });

  registerTool(server, {
    name: "list_items",
    description:
      "List items in a 1Password vault with optional category filtering. Use this to discover passwords, API keys, credit cards, and other items stored in a vault. Returns item IDs, titles, categories, and last updated timestamps.",
    inputSchema: listItemsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => handleListItems(params as ListItemsInput),
  });

  registerTool(server, {
    name: "get_item",
    description:
      "Get complete details of a 1Password item including all fields (username, password, URLs, notes, custom fields). Each field includes its value and secret reference for use with read_secret. Use this when you need full item details beyond just the list metadata.",
    inputSchema: getItemSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => handleGetItem(params as GetItemInput),
  });

  registerTool(server, {
    name: "read_secret",
    description:
      "Read a secret value using a 1Password secret reference URI (format: op://vault/item/field). Use this to retrieve passwords, API keys, tokens, and other sensitive data. The reference can be obtained from the get_item response. Example: op://Private/GitHub/password",
    inputSchema: readSecretSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (params) => handleReadSecret(params as ReadSecretInput),
  });

  return server;
}
