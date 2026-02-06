import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { logger } from "../utils/logger.js";
import { getConfig } from "../config/index.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/gmail.settings.basic",
  "https://www.googleapis.com/auth/calendar",
];

interface Credentials {
  web?: {
    client_id: string;
    client_secret: string;
    redirect_uris?: string[];
  };
  installed?: {
    client_id: string;
    client_secret: string;
    redirect_uris?: string[];
  };
}

interface StoredToken {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  expiry_date: number;
}

let oauth2Client: OAuth2Client | null = null;

/**
 * Load OAuth credentials from file
 */
export function loadCredentials(): Credentials {
  const config = getConfig();
  const credentialsPath = config.gmail.credentialsPath;

  if (!existsSync(credentialsPath)) {
    throw new Error(
      `Gmail credentials file not found at ${credentialsPath}. ` +
        "Please download OAuth credentials from Google Cloud Console."
    );
  }

  const content = readFileSync(credentialsPath, "utf-8");
  return JSON.parse(content);
}

/**
 * Load stored token from file
 */
export function loadToken(): StoredToken | null {
  const config = getConfig();
  const tokenPath = config.gmail.tokenPath;

  if (!existsSync(tokenPath)) {
    return null;
  }

  try {
    const content = readFileSync(tokenPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    logger.warn("Failed to load token file", { error });
    return null;
  }
}

/**
 * Save token to file
 */
export function saveToken(token: StoredToken): void {
  const config = getConfig();
  const tokenPath = config.gmail.tokenPath;

  // Ensure directory exists
  const dir = dirname(tokenPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    logger.info("Created token directory", { path: dir });
  }

  writeFileSync(tokenPath, JSON.stringify(token, null, 2));
  logger.info("Token saved", { path: tokenPath });
}

/**
 * Create OAuth2 client
 */
export function createOAuth2Client(): OAuth2Client {
  const credentials = loadCredentials();
  const creds = credentials.web ?? credentials.installed;

  if (!creds) {
    throw new Error("Invalid credentials file: missing web or installed configuration");
  }

  const redirectUri = creds.redirect_uris?.[0] ?? "http://localhost:9090/oauth2callback";

  return new google.auth.OAuth2(creds.client_id, creds.client_secret, redirectUri);
}

/**
 * Get authorization URL for OAuth flow
 */
export function getAuthUrl(client: OAuth2Client): string {
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // Force consent to always get refresh token
  });
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  client: OAuth2Client,
  code: string
): Promise<StoredToken> {
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh token received. You may need to revoke app access and try again."
    );
  }

  const storedToken: StoredToken = {
    access_token: tokens.access_token!,
    refresh_token: tokens.refresh_token,
    scope: tokens.scope!,
    token_type: tokens.token_type!,
    expiry_date: tokens.expiry_date!,
  };

  saveToken(storedToken);
  return storedToken;
}

/**
 * Refresh access token if expired
 */
async function refreshTokenIfNeeded(client: OAuth2Client): Promise<void> {
  const credentials = client.credentials;

  // Check if token will expire in next 5 minutes
  const expiryDate = credentials.expiry_date;
  const now = Date.now();
  const bufferMs = 5 * 60 * 1000;

  if (expiryDate && now > expiryDate - bufferMs) {
    logger.info("Refreshing access token");
    const { credentials: newCredentials } = await client.refreshAccessToken();
    client.setCredentials(newCredentials);

    // Save updated token
    const token = loadToken();
    if (token) {
      saveToken({
        ...token,
        access_token: newCredentials.access_token!,
        expiry_date: newCredentials.expiry_date!,
      });
    }
  }
}

/**
 * Get authenticated OAuth2 client
 */
export async function getAuthenticatedClient(): Promise<OAuth2Client> {
  if (oauth2Client) {
    await refreshTokenIfNeeded(oauth2Client);
    return oauth2Client;
  }

  const token = loadToken();
  if (!token) {
    throw new Error(
      "No Gmail token found. Please run 'npm run setup-oauth' to authenticate."
    );
  }

  const client = createOAuth2Client();
  client.setCredentials({
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    scope: token.scope,
    token_type: token.token_type,
    expiry_date: token.expiry_date,
  });

  await refreshTokenIfNeeded(client);
  oauth2Client = client;

  logger.info("Gmail OAuth2 client initialized");
  return client;
}

/**
 * Check if we have a valid token
 */
export function hasValidToken(): boolean {
  const token = loadToken();
  return token !== null && !!token.refresh_token;
}

/**
 * Get OAuth scopes
 */
export function getScopes(): string[] {
  return [...SCOPES];
}
