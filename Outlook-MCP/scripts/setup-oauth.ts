#!/usr/bin/env tsx
/**
 * Outlook OAuth Setup Script (Device Code Flow)
 *
 * This script authenticates with Microsoft Graph API by:
 * 1. Displaying a device code and URL for the user to visit
 * 2. Polling until the user completes authentication
 * 3. Caching the tokens for future use
 *
 * Usage: npm run setup-oauth
 */

import { config as dotenvConfig } from "dotenv";
dotenvConfig();

import {
  createMsalApp,
  acquireTokenByDeviceCode,
  hasValidToken,
  loadCredentials,
} from "../src/outlook/auth.js";

async function main(): Promise<void> {
  console.log("\n🔐 Outlook OAuth Setup (Device Code Flow)\n");
  console.log("=".repeat(50));

  // Check if already authenticated
  if (hasValidToken()) {
    console.log("\n✅ You already have a valid token cache!");
    console.log("   To re-authenticate, delete the token cache file and run this again.\n");
    process.exit(0);
  }

  // Verify credentials exist
  try {
    const credentials = loadCredentials();
    console.log(`\n📄 Credentials loaded (Client ID: ${credentials.clientId.slice(0, 12)}...)`);
  } catch (error) {
    console.error("\n❌ Failed to load credentials:");
    console.error(`   ${error instanceof Error ? error.message : error}`);
    console.error("\n   Please ensure you have:");
    console.error("   1. Registered an app in Azure Portal (portal.azure.com)");
    console.error("      → Microsoft Entra ID → App Registrations → New Registration");
    console.error("   2. Enabled 'Allow public client flows' under Authentication");
    console.error("   3. Added API permissions: Mail.ReadWrite, Mail.Send, User.Read");
    console.error("   4. Created ~/.hexa-puffs/outlook/credentials.json with:");
    console.error('      { "clientId": "<Application ID>", "tenantId": "<Directory ID>" }\n');
    process.exit(1);
  }

  console.log("\n📡 Starting device code authentication...\n");

  const app = createMsalApp();

  try {
    const result = await acquireTokenByDeviceCode(app, (message, userCode, verificationUri) => {
      console.log("━".repeat(50));
      console.log(`\n   🌐 Visit: ${verificationUri}`);
      console.log(`   📋 Enter code: ${userCode}\n`);
      console.log("━".repeat(50));
      console.log(`\n   ${message}\n`);
      console.log("   Waiting for authentication...\n");
    });

    console.log("\n✅ Authentication successful!");
    console.log(`   Signed in as: ${result.account?.username ?? "unknown"}`);
    console.log("   Token cache has been saved.\n");
    console.log("   You can now start the Outlook MCP server with:");
    console.log("   npm run dev\n");
  } catch (error) {
    console.error("\n❌ Authentication failed:");
    console.error(`   ${error instanceof Error ? error.message : error}\n`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
