import { z } from "zod";
import { getChat } from "../../telegram/client.js";

export const getChatSchema = z.object({
  chat_id: z.string().describe("Chat ID or username to get info for"),
});


export async function handleGetChat(input: unknown) {
  const result = getChatSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid input: ${result.error.message}`);
  }

  const { chat_id } = result.data;
  const chat = await getChat(chat_id);

  return chat;
}

export const getChatTool = {
  name: "get_chat",
  description: "Get detailed information about a chat, user, or channel",
  inputSchema: {
    type: "object" as const,
    properties: {
      chat_id: {
        type: "string",
        description: "Chat ID or username (e.g., '@username' or numeric ID)",
      },
    },
    required: ["chat_id"],
  },
};
