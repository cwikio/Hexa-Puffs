import { z } from "zod";
import { getMe } from "../../telegram/client.js";

export const getMeSchema = z.object({});

export async function handleGetMe() {
  const user = await getMe();

  return {
    success: true,
    user,
  };
}

export const getMeTool = {
  name: "get_me",
  description: "Get information about the current authenticated Telegram account",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};
