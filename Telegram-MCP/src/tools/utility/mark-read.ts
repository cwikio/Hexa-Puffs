import { z } from "zod";
import { markRead } from "../../telegram/client.js";

export const markReadSchema = z.object({
  chat_id: z.string().describe("Chat ID to mark as read"),
  message_id: z.number().optional().describe("Mark messages up to this ID as read"),
});


export async function handleMarkRead(input: unknown) {
  const result = markReadSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid input: ${result.error.message}`);
  }

  const { chat_id, message_id } = result.data;
  await markRead(chat_id, message_id);

  return {
    success: true,
    chat_id,
    marked_up_to: message_id || "all",
  };
}

export const markReadTool = {
  name: "mark_read",
  description: "Mark messages as read in a chat",
  inputSchema: {
    type: "object" as const,
    properties: {
      chat_id: {
        type: "string",
        description: "Chat ID to mark as read",
      },
      message_id: {
        type: "number",
        description: "Mark messages up to this ID as read (optional, marks all if omitted)",
      },
    },
    required: ["chat_id"],
  },
};
