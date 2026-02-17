import { z } from "zod";
import {
  clearMessageQueue,
  getMessageQueue,
  getQueueSize,
} from "../../telegram/events.js";

export const getNewMessagesSchema = z.object({
  peek: z
    .boolean()
    .optional()
    .describe("If true, return messages without clearing queue"),
});

export const getNewMessagesTool = {
  name: "get_new_messages",
  description:
    "Get new messages received since last call. Returns and clears the message queue unless peek=true.",
  inputSchema: {
    type: "object" as const,
    properties: {
      peek: {
        type: "boolean",
        description: "If true, return messages without clearing queue",
      },
    },
    required: [] as string[],
  },
};

export async function handleGetNewMessages(input: unknown) {
  const result = getNewMessagesSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid input: ${result.error.message}`);
  }

  const { peek = false } = result.data;

  if (peek) {
    const messages = getMessageQueue();
    return {
      messages,
      count: messages.length,
      queueSize: getQueueSize(),
    };
  }

  const messages = clearMessageQueue();
  return {
    messages,
    count: messages.length,
    cleared: true,
  };
}
