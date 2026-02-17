import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

async function test() {
  const apiId = parseInt(process.env.TELEGRAM_API_ID!, 10);
  const apiHash = process.env.TELEGRAM_API_HASH!;
  const sessionString = process.env.TELEGRAM_SESSION!;

  const session = new StringSession(sessionString);
  const client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 3,
  });

  await client.connect();
  console.log("Connected!\n");

  // List chats
  console.log("=== Your Chats ===");
  const dialogs = await client.getDialogs({ limit: 10 });

  for (const dialog of dialogs) {
    const entity = dialog.entity;
    if (!entity) continue;

    let id = "";
    let name = "";
    let username = "";

    if ("id" in entity) {
      id = entity.id.toString();
    }
    if ("firstName" in entity) {
      name = [entity.firstName, entity.lastName].filter(Boolean).join(" ");
    } else if ("title" in entity) {
      name = entity.title || "";
    }
    if ("username" in entity && entity.username) {
      username = `@${entity.username}`;
    }

    console.log(`  ID: ${id}`);
    console.log(`  Name: ${name}`);
    console.log(`  Username: ${username || "(none)"}`);
    console.log("");
  }

  // Try sending to the first chat
  if (dialogs.length > 0 && dialogs[0].entity) {
    const firstChat = dialogs[0].entity;
    const chatId = "id" in firstChat ? firstChat.id.toString() : "";

    console.log(`\n=== Sending test message to first chat (ID: ${chatId}) ===`);
    try {
      const result = await client.sendMessage(chatId, {
        message: "Test from MCP script!",
      });
      console.log("Message sent successfully!");
      console.log(`Message ID: ${result.id}`);
    } catch (error) {
      console.error("Failed to send:", error);
    }
  }

  await client.disconnect();
}

test().catch(console.error);
