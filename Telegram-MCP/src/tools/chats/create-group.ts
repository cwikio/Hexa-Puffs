import { z } from "zod";
import { createGroup } from "../../telegram/client.js";

export const createGroupSchema = z.object({
  title: z.string().min(1).describe("Title for the new group"),
  user_ids: z.array(z.string()).min(1).describe("Array of user IDs to add to the group"),
});


export async function handleCreateGroup(input: unknown) {
  const result = createGroupSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid input: ${result.error.message}`);
  }

  const { title, user_ids } = result.data;
  const chat = await createGroup(title, user_ids);

  return {
    success: true,
    chat,
  };
}

export const createGroupTool = {
  name: "create_group",
  description: "Create a new Telegram group chat with specified users",
  inputSchema: {
    type: "object" as const,
    properties: {
      title: {
        type: "string",
        description: "Title for the new group",
      },
      user_ids: {
        type: "array",
        items: { type: "string" },
        description: "Array of user IDs or usernames to add to the group",
      },
    },
    required: ["title", "user_ids"],
  },
};
