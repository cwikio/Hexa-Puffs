import { z } from "zod";
import {
  subscribeToChat,
  unsubscribeFromChat,
  getSubscribedChats,
  clearSubscriptions,
} from "../../telegram/events.js";

export const subscribeChatSchema = z.object({
  chat_id: z.string().optional().describe("Chat ID to subscribe/unsubscribe"),
  action: z
    .enum(["subscribe", "unsubscribe", "list", "clear"])
    .describe("Action to perform"),
});

export const subscribeChatTool = {
  name: "subscribe_chat",
  description:
    "Manage chat subscriptions for real-time messages. Subscribe to specific chats or receive all.",
  inputSchema: {
    type: "object" as const,
    properties: {
      chat_id: {
        type: "string",
        description: "Chat ID to subscribe/unsubscribe",
      },
      action: {
        type: "string",
        enum: ["subscribe", "unsubscribe", "list", "clear"],
        description:
          "subscribe=add chat, unsubscribe=remove chat, list=show subscriptions, clear=receive all",
      },
    },
    required: ["action"] as string[],
  },
};

export async function handleSubscribeChat(input: unknown) {
  const result = subscribeChatSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid input: ${result.error.message}`);
  }

  const { chat_id, action } = result.data;

  switch (action) {
    case "subscribe":
      if (!chat_id) throw new Error("chat_id required for subscribe");
      subscribeToChat(chat_id);
      return {
        success: true,
        subscribed: chat_id,
        total: getSubscribedChats().length,
      };

    case "unsubscribe":
      if (!chat_id) throw new Error("chat_id required for unsubscribe");
      unsubscribeFromChat(chat_id);
      return {
        success: true,
        unsubscribed: chat_id,
        total: getSubscribedChats().length,
      };

    case "list": {
      const chats = getSubscribedChats();
      return {
        subscriptions: chats,
        count: chats.length,
        mode: chats.length === 0 ? "all_chats" : "filtered",
      };
    }

    case "clear":
      clearSubscriptions();
      return {
        success: true,
        message: "Cleared subscriptions, now receiving all chats",
      };
  }
}
