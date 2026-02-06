import "dotenv/config";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

async function test() {
  console.log("=== Telegram MCP Connection Test ===\n");

  // Check environment variables
  const apiId = process.env.TELEGRAM_API_ID;
  const apiHash = process.env.TELEGRAM_API_HASH;
  const sessionString = process.env.TELEGRAM_SESSION;

  console.log("1. Checking environment variables...");

  if (!apiId) {
    console.error("   ❌ TELEGRAM_API_ID is missing");
    process.exit(1);
  }
  console.log("   ✓ TELEGRAM_API_ID is set");

  if (!apiHash) {
    console.error("   ❌ TELEGRAM_API_HASH is missing");
    process.exit(1);
  }
  console.log("   ✓ TELEGRAM_API_HASH is set");

  if (!sessionString) {
    console.error("   ❌ TELEGRAM_SESSION is missing");
    process.exit(1);
  }
  console.log("   ✓ TELEGRAM_SESSION is set");

  // Test connection
  console.log("\n2. Connecting to Telegram...");

  try {
    const session = new StringSession(sessionString);
    const client = new TelegramClient(session, parseInt(apiId, 10), apiHash, {
      connectionRetries: 3,
    });

    await client.connect();
    console.log("   ✓ Connected successfully");

    // Get current user
    console.log("\n3. Getting account info...");
    const me = await client.getMe();

    if (me && "firstName" in me) {
      console.log(`   ✓ Logged in as: ${me.firstName} ${me.lastName || ""}`);
      console.log(`   ✓ Username: @${me.username || "none"}`);
      console.log(`   ✓ Phone: ${me.phone || "hidden"}`);
    }

    // Get dialogs count
    console.log("\n4. Testing API access...");
    const dialogs = await client.getDialogs({ limit: 5 });
    console.log(`   ✓ Can access dialogs: ${dialogs.length} chats retrieved`);

    await client.disconnect();

    console.log("\n=== All tests passed! ===");
    console.log("\nThe Telegram MCP server should work correctly.");

  } catch (error) {
    console.error("\n   ❌ Connection failed:");
    console.error(`   ${error instanceof Error ? error.message : error}`);

    if (error instanceof Error && error.message.includes("AUTH_KEY")) {
      console.error("\n   → Your session may have expired. Run 'npm run setup' to generate a new one.");
    }

    process.exit(1);
  }
}

test();
