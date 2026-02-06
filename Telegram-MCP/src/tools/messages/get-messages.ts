import { z } from "zod";
import { getMessages } from "../../telegram/client.js";

export const getMessagesSchema = z.object({
  chat_id: z.string().describe("Chat ID or username to get messages from"),
  limit: z.number().min(1).max(100).default(20).describe("Number of messages to retrieve"),
  offset_id: z.number().optional().describe("Get messages before this message ID"),
});

export type GetMessagesInput = z.infer<typeof getMessagesSchema>;

export async function handleGetMessages(input: GetMessagesInput) {
  const result = getMessagesSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid input: ${result.error.message}`);
  }

  const { chat_id, limit, offset_id } = result.data;
  const messages = await getMessages(chat_id, limit, offset_id);

  return {
    chat_id,
    count: messages.length,
    messages,
  };
}

export const getMessagesTool = {
  name: "get_messages",
  description: "Get message history from a Telegram chat",
  inputSchema: {
    type: "object" as const,
    properties: {
      chat_id: {
        type: "string",
        description: "Chat ID or username to get messages from",
      },
      limit: {
        type: "number",
        description: "Number of messages to retrieve (1-100, default 20)",
      },
      offset_id: {
        type: "number",
        description: "Get messages before this message ID (for pagination)",
      },
    },
    required: ["chat_id"],
  },
};
