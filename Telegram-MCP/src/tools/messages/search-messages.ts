import { z } from "zod";
import { searchMessages } from "../../telegram/client.js";

export const searchMessagesSchema = z.object({
  query: z.string().describe("Search query"),
  chat_id: z.string().optional().describe("Chat ID to search in (omit for global search)"),
  limit: z.number().min(1).max(100).default(20).describe("Maximum number of results"),
});


export async function handleSearchMessages(input: unknown) {
  const result = searchMessagesSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid input: ${result.error.message}`);
  }

  const { query, chat_id, limit } = result.data;
  const messages = await searchMessages(query, chat_id, limit);

  return {
    query,
    chat_id: chat_id || "global",
    count: messages.length,
    messages,
  };
}

export const searchMessagesTool = {
  name: "search_messages",
  description: "Search Telegram messages by text query. Provide chat_id to search within one chat, or omit it to search globally across all chats. Use get_messages instead if you just want recent history without a search query.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Search query text",
      },
      chat_id: {
        type: "string",
        description: "Chat ID to search in (omit for global search across all chats)",
      },
      limit: {
        type: "number",
        description: "Maximum number of results (1-100, default 20)",
      },
    },
    required: ["query"],
  },
};
