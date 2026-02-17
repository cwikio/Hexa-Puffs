import {
  PublicClientApplication,
  type Configuration,
  type AccountInfo,
  type AuthenticationResult,
  type DeviceCodeRequest,
} from "@azure/msal-node";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { logger } from "../utils/logger.js";
import { getConfig } from "../config/index.js";

const SCOPES = [
  "Mail.ReadWrite",
  "Mail.Send",
  "User.Read",
  "offline_access",
];

interface OutlookCredentials {
  clientId: string;
  tenantId: string;
}

let msalApp: PublicClientApplication | null = null;
let cachedAccount: AccountInfo | null = null;

/**
 * Load Microsoft app credentials from file
 */
export function loadCredentials(): OutlookCredentials {
  const config = getConfig();
  const credentialsPath = config.outlook.credentialsPath;

  if (!existsSync(credentialsPath)) {
    throw new Error(
      `Outlook credentials file not found at ${credentialsPath}. ` +
        "Please create it with your Azure app registration details: { \"clientId\": \"...\", \"tenantId\": \"...\" }"
    );
  }

  const content = readFileSync(credentialsPath, "utf-8");
  const parsed = JSON.parse(content);

  if (!parsed.clientId || !parsed.tenantId) {
    throw new Error(
      "Invalid credentials file: must contain clientId and tenantId"
    );
  }

  return parsed;
}

/**
 * Build MSAL cache plugin for file-based token persistence
 */
function buildCachePlugin() {
  const config = getConfig();
  const cachePath = config.outlook.tokenCachePath;

  return {
    beforeCacheAccess: async (cacheContext: { tokenCache: { deserialize: (data: string) => void } }) => {
      if (existsSync(cachePath)) {
        const data = readFileSync(cachePath, "utf-8");
        cacheContext.tokenCache.deserialize(data);
      }
    },
    afterCacheAccess: async (cacheContext: { cacheHasChanged: boolean; tokenCache: { serialize: () => string } }) => {
      if (cacheContext.cacheHasChanged) {
        const dir = dirname(cachePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(cachePath, cacheContext.tokenCache.serialize());
      }
    },
  };
}

/**
 * Create MSAL PublicClientApplication
 */
export function createMsalApp(): PublicClientApplication {
  const credentials = loadCredentials();

  const msalConfig: Configuration = {
    auth: {
      clientId: credentials.clientId,
      authority: `https://login.microsoftonline.com/${credentials.tenantId}`,
    },
    cache: {
      cachePlugin: buildCachePlugin(),
    },
  };

  return new PublicClientApplication(msalConfig);
}

/**
 * Get the first cached account from the token cache
 */
async function getCachedAccount(app: PublicClientApplication): Promise<AccountInfo | null> {
  const cache = app.getTokenCache();
  const accounts = await cache.getAllAccounts();
  return accounts.length > 0 ? accounts[0] : null;
}

/**
 * Acquire token silently using cached refresh token
 */
export async function acquireTokenSilent(
  app: PublicClientApplication,
  account: AccountInfo
): Promise<AuthenticationResult> {
  return app.acquireTokenSilent({
    scopes: SCOPES,
    account,
  });
}

/**
 * Acquire token via device code flow (interactive)
 */
export async function acquireTokenByDeviceCode(
  app: PublicClientApplication,
  onDeviceCode: (message: string, userCode: string, verificationUri: string) => void
): Promise<AuthenticationResult> {
  const request: DeviceCodeRequest = {
    scopes: SCOPES,
    deviceCodeCallback: (response) => {
      onDeviceCode(response.message, response.userCode, response.verificationUri);
    },
  };

  const result = await app.acquireTokenByDeviceCode(request);
  if (!result) {
    throw new Error("Device code authentication returned no result");
  }
  return result;
}

/**
 * Get an authenticated access token (auto-refresh via MSAL)
 */
export async function getAccessToken(): Promise<string> {
  if (!msalApp) {
    msalApp = createMsalApp();
  }

  if (!cachedAccount) {
    cachedAccount = await getCachedAccount(msalApp);
  }

  if (!cachedAccount) {
    throw new Error(
      "No Outlook account found in token cache. Run 'npm run setup-oauth' to authenticate."
    );
  }

  try {
    const result = await acquireTokenSilent(msalApp, cachedAccount);
    return result.accessToken;
  } catch (error) {
    // If silent fails, the refresh token may be expired
    logger.error("Silent token acquisition failed", { error });
    cachedAccount = null;
    msalApp = null;
    throw new Error(
      "Outlook token expired. Run 'npm run setup-oauth' to re-authenticate."
    );
  }
}

/**
 * Check if we have a cached account (valid token cache exists)
 */
export function hasValidToken(): boolean {
  const config = getConfig();
  const cachePath = config.outlook.tokenCachePath;

  if (!existsSync(cachePath)) {
    return false;
  }

  try {
    const content = readFileSync(cachePath, "utf-8");
    const parsed = JSON.parse(content);
    // MSAL cache has an Account section — check it's non-empty
    return parsed.Account && Object.keys(parsed.Account).length > 0;
  } catch {
    return false;
  }
}

/**
 * Get OAuth scopes
 */
export function getScopes(): string[] {
  return [...SCOPES];
}
