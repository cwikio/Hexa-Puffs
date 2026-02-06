import { z } from "zod";
import { addContact } from "../../telegram/client.js";

export const addContactSchema = z.object({
  phone: z.string().describe("Phone number with country code (e.g., +1234567890)"),
  first_name: z.string().min(1).describe("Contact's first name"),
  last_name: z.string().optional().describe("Contact's last name"),
});


export async function handleAddContact(input: unknown) {
  const result = addContactSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid input: ${result.error.message}`);
  }

  const { phone, first_name, last_name } = result.data;
  const contact = await addContact(phone, first_name, last_name);

  return {
    success: true,
    contact,
  };
}

export const addContactTool = {
  name: "add_contact",
  description: "Add a new contact to Telegram by phone number",
  inputSchema: {
    type: "object" as const,
    properties: {
      phone: {
        type: "string",
        description: "Phone number with country code (e.g., +1234567890)",
      },
      first_name: {
        type: "string",
        description: "Contact's first name",
      },
      last_name: {
        type: "string",
        description: "Contact's last name (optional)",
      },
    },
    required: ["phone", "first_name"],
  },
};
