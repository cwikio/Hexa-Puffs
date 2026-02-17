import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function main() {
  console.log("=== Telegram MCP Session Setup ===\n");

  const apiIdStr = process.env.TELEGRAM_API_ID || (await prompt("Enter your API ID: "));
  const apiHash = process.env.TELEGRAM_API_HASH || (await prompt("Enter your API Hash: "));

  const apiId = parseInt(apiIdStr, 10);
  if (isNaN(apiId)) {
    console.error("Invalid API ID");
    process.exit(1);
  }

  const stringSession = new StringSession("");
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  console.log("\nConnecting to Telegram...");

  await client.start({
    phoneNumber: async () => {
      return await prompt("Enter your phone number (with country code, e.g., +1234567890): ");
    },
    password: async () => {
      return await prompt("Enter your 2FA password (press Enter if none): ");
    },
    phoneCode: async () => {
      return await prompt("Enter the verification code sent to your Telegram: ");
    },
    onError: (err) => {
      console.error("Error during authentication:", err.message);
    },
  });

  console.log("\n=== Authentication successful! ===\n");

  const sessionString = client.session.save() as unknown as string;

  console.log("Add this to your .env file:\n");
  console.log(`TELEGRAM_API_ID=${apiId}`);
  console.log(`TELEGRAM_API_HASH=${apiHash}`);
  console.log(`TELEGRAM_SESSION=${sessionString}`);
  console.log("\n=== Setup complete ===");

  await client.disconnect();
  rl.close();
}

main().catch((error) => {
  console.error("Setup failed:", error);
  rl.close();
  process.exit(1);
});
