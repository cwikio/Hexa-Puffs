import { z } from "zod";
import { deleteMessages } from "../../telegram/client.js";

export const deleteMessagesSchema = z.object({
  chat_id: z.string().describe("Chat ID where messages are located"),
  message_ids: z.array(z.number()).min(1).describe("Array of message IDs to delete"),
});


export async function handleDeleteMessages(input: unknown) {
  const result = deleteMessagesSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid input: ${result.error.message}`);
  }

  const { chat_id, message_ids } = result.data;
  await deleteMessages(chat_id, message_ids);

  return {
    success: true,
    deleted_count: message_ids.length,
    message_ids,
  };
}

export const deleteMessagesTool = {
  name: "delete_messages",
  description: "Delete messages from a chat (requires appropriate permissions)",
  inputSchema: {
    type: "object" as const,
    properties: {
      chat_id: {
        type: "string",
        description: "Chat ID where messages are located",
      },
      message_ids: {
        type: "array",
        items: { type: "number" },
        description: "Array of message IDs to delete",
      },
    },
    required: ["chat_id", "message_ids"],
  },
};
