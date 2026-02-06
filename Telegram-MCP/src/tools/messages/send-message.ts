import { z } from "zod";
import { sendMessage } from "../../telegram/client.js";

export const sendMessageSchema = z.object({
  chat_id: z.string().describe("Chat ID or username to send message to"),
  message: z.string().describe("Text message to send"),
  reply_to: z.number().optional().describe("Message ID to reply to"),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export async function handleSendMessage(input: SendMessageInput) {
  const result = sendMessageSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid input: ${result.error.message}`);
  }

  const { chat_id, message, reply_to } = result.data;
  const sentMessage = await sendMessage(chat_id, message, reply_to);

  return {
    success: true,
    message: sentMessage,
  };
}

export const sendMessageTool = {
  name: "send_message",
  description: "Send a text message to a Telegram chat, user, or channel",
  inputSchema: {
    type: "object" as const,
    properties: {
      chat_id: {
        type: "string",
        description: "Chat ID or username to send message to (e.g., '@username' or numeric ID)",
      },
      message: {
        type: "string",
        description: "Text message to send",
      },
      reply_to: {
        type: "number",
        description: "Optional message ID to reply to",
      },
    },
    required: ["chat_id", "message"],
  },
};
