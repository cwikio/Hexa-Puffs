import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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

  server.tool(
    "list_vaults",
    "List all accessible 1Password vaults. Use this as the first step to discover available vaults before listing items or retrieving secrets. Returns vault IDs and names.",
    listVaultsSchema.shape,
    async (params) => {
      const result = listVaultsSchema.safeParse(params);
      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: `Invalid parameters: ${result.error.message}`,
              }),
            },
          ],
        };
      }
      const response = await handleListVaults(result.data);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    }
  );

  server.tool(
    "list_items",
    "List items in a 1Password vault with optional category filtering. Use this to discover passwords, API keys, credit cards, and other items stored in a vault. Returns item IDs, titles, categories, and last updated timestamps.",
    listItemsSchema.shape,
    async (params) => {
      const result = listItemsSchema.safeParse(params);
      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: `Invalid parameters: ${result.error.message}`,
              }),
            },
          ],
        };
      }
      const response = await handleListItems(result.data);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    }
  );

  server.tool(
    "get_item",
    "Get complete details of a 1Password item including all fields (username, password, URLs, notes, custom fields). Each field includes its value and secret reference for use with read_secret. Use this when you need full item details beyond just the list metadata.",
    getItemSchema.shape,
    async (params) => {
      const result = getItemSchema.safeParse(params);
      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: `Invalid parameters: ${result.error.message}`,
              }),
            },
          ],
        };
      }
      const response = await handleGetItem(result.data);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    }
  );

  server.tool(
    "read_secret",
    "Read a secret value using a 1Password secret reference URI (format: op://vault/item/field). Use this to retrieve passwords, API keys, tokens, and other sensitive data. The reference can be obtained from the get_item response. Example: op://Private/GitHub/password",
    readSecretSchema.shape,
    async (params) => {
      const result = readSecretSchema.safeParse(params);
      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: `Invalid parameters: ${result.error.message}`,
              }),
            },
          ],
        };
      }
      const response = await handleReadSecret(result.data);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };
    }
  );

  return server;
}
