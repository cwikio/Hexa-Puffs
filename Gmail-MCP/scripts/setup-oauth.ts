#!/usr/bin/env tsx
/**
 * Gmail OAuth Setup Script
 *
 * This script helps you authenticate with Gmail API by:
 * 1. Opening a browser to Google's OAuth consent screen
 * 2. Starting a local server to receive the callback
 * 3. Exchanging the auth code for tokens
 * 4. Saving the tokens for future use
 *
 * Usage: npm run setup-oauth
 */

import { config as dotenvConfig } from "dotenv";
dotenvConfig();

import { createServer } from "http";
import { URL } from "url";
import { exec } from "child_process";
import { platform } from "os";
import {
  createOAuth2Client,
  getAuthUrl,
  exchangeCodeForTokens,
  hasValidToken,
  loadCredentials,
} from "../src/gmail/auth.js";

const PORT = 9090;
const REDIRECT_PATH = "/oauth2callback";

async function openBrowser(url: string): Promise<void> {
  const os = platform();
  let command: string;

  switch (os) {
    case "darwin":
      command = `open "${url}"`;
      break;
    case "win32":
      command = `start "${url}"`;
      break;
    default:
      command = `xdg-open "${url}"`;
  }

  return new Promise((resolve, reject) => {
    exec(command, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function main(): Promise<void> {
  console.log("\n🔐 Gmail OAuth Setup\n");
  console.log("=".repeat(50));

  // Check if already authenticated
  if (hasValidToken()) {
    console.log("\n✅ You already have a valid token!");
    console.log("   To re-authenticate, delete the token file and run this again.\n");
    process.exit(0);
  }

  // Verify credentials exist
  try {
    const credentials = loadCredentials();
    const creds = credentials.web ?? credentials.installed;
    if (!creds) {
      throw new Error("Invalid credentials");
    }
    console.log(`\n📄 Credentials loaded (Client ID: ${creds.client_id.slice(0, 20)}...)`);
  } catch (error) {
    console.error("\n❌ Failed to load credentials:");
    console.error(`   ${error instanceof Error ? error.message : error}`);
    console.error("\n   Please ensure you have:");
    console.error("   1. Created OAuth credentials in Google Cloud Console");
    console.error("   2. Enabled the Gmail API");
    console.error("   3. Downloaded the credentials JSON file");
    console.error(`   4. Placed it at the path specified in GMAIL_CREDENTIALS_PATH\n`);
    process.exit(1);
  }

  // Create OAuth client
  const oauth2Client = createOAuth2Client();

  // Create callback server
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

      if (url.pathname === REDIRECT_PATH) {
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>❌ Authorization Failed</h1>
                <p>Error: ${error}</p>
                <p>Please try again.</p>
              </body>
            </html>
          `);
          console.error(`\n❌ Authorization failed: ${error}\n`);
          server.close();
          reject(new Error(error));
          return;
        }

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>❌ No Authorization Code</h1>
                <p>Please try again.</p>
              </body>
            </html>
          `);
          server.close();
          reject(new Error("No authorization code received"));
          return;
        }

        try {
          console.log("\n📥 Received authorization code, exchanging for tokens...");
          await exchangeCodeForTokens(oauth2Client, code);

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>✅ Authorization Successful!</h1>
                <p>Gmail MCP is now authenticated.</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);

          console.log("\n✅ Authentication successful!");
          console.log("   Token has been saved.\n");
          console.log("   You can now start the Gmail MCP server with:");
          console.log("   npm run dev\n");

          server.close();
          resolve();
        } catch (tokenError) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <body style="font-family: system-ui; padding: 40px; text-align: center;">
                <h1>❌ Token Exchange Failed</h1>
                <p>${tokenError instanceof Error ? tokenError.message : tokenError}</p>
              </body>
            </html>
          `);

          console.error("\n❌ Token exchange failed:");
          console.error(`   ${tokenError instanceof Error ? tokenError.message : tokenError}\n`);
          server.close();
          reject(tokenError);
        }
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    server.listen(PORT, async () => {
      const authUrl = getAuthUrl(oauth2Client);

      console.log(`\n🌐 Authorization URL:`);
      console.log(`   ${authUrl}\n`);
      console.log(`📡 Listening on http://localhost:${PORT}${REDIRECT_PATH}`);
      console.log("\n   Opening browser...\n");

      try {
        await openBrowser(authUrl);
      } catch {
        console.log("   Could not open browser automatically.");
        console.log("   Please open the URL above manually.\n");
      }
    });

    server.on("error", (err) => {
      console.error(`\n❌ Server error: ${err.message}`);
      reject(err);
    });
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
