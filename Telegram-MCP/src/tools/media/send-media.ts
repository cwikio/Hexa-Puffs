import { z } from "zod";
import { sendMedia } from "../../telegram/client.js";

export const sendMediaSchema = z.object({
  chat_id: z.string().describe("Chat ID or username to send media to"),
  file_path: z.string().describe("Local file path or URL (http/https) to the image or file to send"),
  caption: z.string().optional().describe("Caption for the media"),
});


export async function handleSendMedia(input: unknown) {
  const result = sendMediaSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid input: ${result.error.message}`);
  }

  const { chat_id, file_path, caption } = result.data;
  const message = await sendMedia(chat_id, file_path, caption);

  return {
    success: true,
    message,
  };
}

export const sendMediaTool = {
  name: "send_media",
  description: "Send a photo or document to a Telegram chat. Accepts local file paths or URLs.",
  inputSchema: {
    type: "object" as const,
    properties: {
      chat_id: {
        type: "string",
        description: "Chat ID or username to send media to",
      },
      file_path: {
        type: "string",
        description: "Local file path or URL (http/https) to the image or file to send",
      },
      caption: {
        type: "string",
        description: "Caption for the media (optional)",
      },
    },
    required: ["chat_id", "file_path"],
  },
};
