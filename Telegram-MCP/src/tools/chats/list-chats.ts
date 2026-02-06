import { z } from "zod";
import { listChats } from "../../telegram/client.js";

export const listChatsSchema = z.object({
  limit: z.number().min(1).max(200).default(50).describe("Maximum number of chats to retrieve"),
});


export async function handleListChats(input: unknown) {
  const result = listChatsSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid input: ${result.error.message}`);
  }

  const { limit } = result.data;
  const chats = await listChats(limit);

  return {
    count: chats.length,
    chats,
  };
}

export const listChatsTool = {
  name: "list_chats",
  description: "List all Telegram dialogs/chats including private chats, groups, and channels",
  inputSchema: {
    type: "object" as const,
    properties: {
      limit: {
        type: "number",
        description: "Maximum number of chats to retrieve (1-200, default 50)",
      },
    },
    required: [],
  },
};
