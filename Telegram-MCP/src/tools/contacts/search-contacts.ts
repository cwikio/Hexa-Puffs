import { z } from "zod";
import { searchUsers } from "../../telegram/client.js";

export const searchUsersSchema = z.object({
  query: z.string().min(1).describe("Search query (username or name)"),
  limit: z.number().min(1).max(50).default(10).describe("Maximum number of results"),
});


export async function handleSearchUsers(input: unknown) {
  const result = searchUsersSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid input: ${result.error.message}`);
  }

  const { query, limit } = result.data;
  const users = await searchUsers(query, limit);

  return {
    query,
    count: users.length,
    users,
  };
}

export const searchUsersTool = {
  name: "search_users",
  description: "Search for Telegram users globally by username or name",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Search query (username or name)",
      },
      limit: {
        type: "number",
        description: "Maximum number of results (1-50, default 10)",
      },
    },
    required: ["query"],
  },
};
