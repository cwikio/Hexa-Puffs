import { listContacts } from "../../telegram/client.js";

export async function handleListContacts() {
  const contacts = await listContacts();

  return {
    count: contacts.length,
    contacts,
  };
}

export const listContactsTool = {
  name: "list_contacts",
  description: "List all saved Telegram contacts",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [],
  },
};
