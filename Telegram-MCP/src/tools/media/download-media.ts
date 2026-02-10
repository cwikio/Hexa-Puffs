import { z } from "zod";
import { downloadMedia } from "../../telegram/client.js";

export const downloadMediaSchema = z.object({
  chat_id: z.string().describe("Chat ID where the message is located"),
  message_id: z.number().describe("Message ID containing the media"),
  output_path: z.string().describe("Path where to save the downloaded file"),
});


export async function handleDownloadMedia(input: unknown) {
  const result = downloadMediaSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid input: ${result.error.message}`);
  }

  const { chat_id, message_id, output_path } = result.data;
  const savedPath = await downloadMedia(chat_id, message_id, output_path);

  return {
    success: true,
    path: savedPath,
  };
}

export const downloadMediaTool = {
  name: "download_media",
  description: "Download media (photo, document, video) from a message",
  inputSchema: {
    type: "object" as const,
    properties: {
      chat_id: {
        type: "string",
        description: "Chat ID where the message is located",
      },
      message_id: {
        type: "number",
        description: "Message ID containing the media to download",
      },
      output_path: {
        type: "string",
        description: "Absolute path where to save the downloaded file",
      },
    },
    required: ["chat_id", "message_id", "output_path"],
  },
};
