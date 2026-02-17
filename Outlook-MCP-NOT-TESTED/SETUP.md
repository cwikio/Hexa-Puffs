# Outlook MCP Setup Guide

This guide walks through registering an Azure app and authenticating so the Outlook MCP can access your Microsoft 365 emails.

**Cost:** Free. Azure app registrations are included with any Microsoft 365 subscription.

---

## Step 1: Register an App in Azure

1. Go to **https://portal.azure.com** and sign in with your **work email** (the same account whose emails you want to access).

2. In the search bar at the top, type **"App registrations"** and click the result.

3. Click **"+ New registration"** at the top.

4. Fill in the form:
   - **Name:** `Hexa Puffs Outlook` (or any name you like)
   - **Supported account types:** Select **"Accounts in this organizational directory only"**
   - **Redirect URI:** Leave blank — not needed for device code flow

5. Click **Register**.

6. You'll land on the app's **Overview** page. Copy these two values — you'll need them later:
   - **Application (client) ID** — a UUID like `a1b2c3d4-e5f6-...`
   - **Directory (tenant) ID** — another UUID like `f6e5d4c3-b2a1-...`

---

## Step 2: Enable Public Client Flows

This allows the app to use the device code flow (no browser redirect needed).

1. In the left sidebar of your app, click **Authentication**.

2. Scroll to the bottom of the page to the section **"Advanced settings"**.

3. Find **"Allow public client flows"** and set it to **Yes**.

4. Click **Save** at the top.

---

## Step 3: Add API Permissions

1. In the left sidebar, click **API permissions**.

2. Click **"+ Add a permission"**.

3. Select **Microsoft Graph**.

4. Select **Delegated permissions** (not Application).

5. Search for and check each of these permissions:
   - `Mail.ReadWrite` — read and modify emails
   - `Mail.Send` — send emails on your behalf
   - `User.Read` — read your basic profile (needed by MSAL)
   - `offline_access` — keep you signed in with a refresh token

6. Click **Add permissions**.

7. The permissions list should now show all four. If your organization requires admin consent, you'll see an orange warning — ask your IT admin to click **"Grant admin consent"**. For most personal/small org tenants, user consent is enough.

---

## Step 4: Save Credentials Locally

Create the credentials file that the MCP reads at startup:

```bash
mkdir -p ~/.hexa-puffs/outlook
```

Create `~/.hexa-puffs/outlook/credentials.json` with the two IDs from Step 1:

```json
{
  "clientId": "paste-your-application-client-id-here",
  "tenantId": "paste-your-directory-tenant-id-here"
}
```

---

## Step 5: Authenticate via Device Code Flow

From the Outlook-MCP directory, run:

```bash
npm run setup-oauth
```

This will:
1. Display a URL (`https://microsoft.com/devicelogin`) and a short code.
2. Open the URL in your browser, enter the code, and sign in with your work account.
3. Accept the permission consent prompt.
4. The script saves your tokens to `~/.hexa-puffs/outlook/token-cache.json`.

You should see:

```
✅ Authentication successful!
   Signed in as: your.email@company.com
   Token cache has been saved.
```

---

## Step 6: Verify

Build and start the MCP to confirm everything works:

```bash
npm run build
```

The Orchestrator will auto-discover the Outlook MCP on next restart.

---

## Troubleshooting

### "Credentials file not found"
Make sure `~/.hexa-puffs/outlook/credentials.json` exists and contains valid `clientId` and `tenantId`.

### "AADSTS7000218: The request body must contain ... client_secret"
You didn't enable **Allow public client flows** in Step 2. Go back to Authentication settings and set it to Yes.

### "AADSTS65001: The user or administrator has not consented"
Your org requires admin consent. Ask your IT admin to grant consent for the app, or try registering with **"Accounts in any organizational directory"** if your admin allows multi-tenant apps.

### "Token expired" errors after some time
Refresh tokens last 90 days by default. If you see token errors, re-run `npm run setup-oauth`.

### "AADSTS50076: MFA required"
This is expected if your org requires multi-factor auth. Complete the MFA prompt during the device code flow — it only needs to happen once.

### Re-authenticating
Delete the token cache and run setup again:

```bash
rm ~/.hexa-puffs/outlook/token-cache.json
npm run setup-oauth
```
