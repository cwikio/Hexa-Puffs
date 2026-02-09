# 1Password MCP Server

An MCP (Model Context Protocol) server that provides read-only access to your 1Password vaults. Works with Claude Desktop and other MCP-compatible clients.

## Features

- **list_vaults** - List all accessible 1Password vaults
- **list_items** - List items in a vault (with optional category filter)
- **get_item** - Get item details including all fields
- **read_secret** - Read a secret using 1Password reference syntax (e.g., `op://vault/item/field`)

## Quick Start

### Step 1: Create a 1Password Service Account

1. Go to [1Password Developer Tools](https://my.1password.com/developer-tools/infrastructure-secrets/serviceaccount)
2. Click **"Create Service Account"**
3. Give it a name (e.g., "MCP Server")
4. **Important:** Grant it access to the vaults you want to expose
5. Copy the token (starts with `ops_`) - you only see it once!

### Step 2: Configure Environment

```bash
cd Onepassword-MCP
cp .env.example .env
```

Edit `.env` and paste your token:

```
OP_SERVICE_ACCOUNT_TOKEN=ops_your_token_here
TRANSPORT=stdio
PORT=3000
```

### Step 3: Build the Docker Image

```bash
docker build -t onepassword-mcp .
```

### Step 4: Configure Claude Desktop

Edit Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "1password": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--env-file", "<repo-root>/Onepassword-MCP/.env",
        "onepassword-mcp"
      ]
    }
  }
}
```

### Step 5: Restart Claude Desktop

1. Quit Claude Desktop completely (**Cmd+Q**)
2. Open Claude Desktop again
3. In a new chat, ask: *"List my 1Password vaults"*

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OP_SERVICE_ACCOUNT_TOKEN` | Yes | - | Your 1Password Service Account token (starts with `ops_`) |
| `TRANSPORT` | No | `stdio` | Transport mode: `stdio` for Claude Desktop, `http` for HTTP/SSE |
| `PORT` | No | `3000` | Port for HTTP mode |

## Alternative: Run in HTTP Mode (Docker Desktop GUI)

Use this if you want to test the server independently or use with HTTP clients.

1. Open **Docker Desktop**
2. Go to **Images** → find `onepassword-mcp` → click **Run**
3. Click **Optional settings** and configure:
   - **Container name**: `1Password-MCP`
   - **Ports**: `3000` → `3000/tcp`
   - **Environment variables**:
     | Variable | Value |
     |----------|-------|
     | `OP_SERVICE_ACCOUNT_TOKEN` | `ops_your_token_here` |
     | `TRANSPORT` | `http` |
4. Click **Run**
5. Test: Open http://localhost:3000/health in your browser

Expected response: `{"status":"healthy","transport":"http"}`

## Troubleshooting

### Manual Checks

**Check if Docker container is running:**
```bash
docker ps | grep onepassword-mcp
```

**Check MCP server health:**
```bash
curl http://localhost:3000/health
```

**List vaults directly via container:**
```bash
docker exec <container-name> op vault list
```

**List items in a vault:**
```bash
docker exec <container-name> op item list --vault="Vault Name"
```

### Common Issues

| Problem | Solution |
|---------|----------|
| "No vaults found" | Grant the service account access to vaults in 1Password settings |
| Container exits immediately | Make sure `TRANSPORT=http` is set for HTTP mode, or use `-i` flag for stdio |
| Claude Desktop doesn't see tools | Restart Claude Desktop completely (Cmd+Q, then reopen) |
| "Unable to connect" in HTTP mode | Check container is running and port 3000 is exposed |

## Tool Reference

### list_vaults

List all vaults accessible to the service account.

```
Parameters: none
```

### list_items

List items in a specific vault.

```
Parameters:
  - vault (required): Vault name or ID
  - categories (optional): Array of categories to filter by
    (Login, Password, SecureNote, CreditCard, Identity, etc.)
```

### get_item

Get full details of an item including all fields.

```
Parameters:
  - item (required): Item name or ID
  - vault (optional): Vault name or ID
```

### read_secret

Read a specific secret value using 1Password secret reference syntax.

```
Parameters:
  - reference (required): Secret reference (e.g., op://vault/item/field)
```

## Security Notes

- The service account token grants access to your vaults - keep it secure
- Only grant the service account access to vaults you need
- The `.env` file is excluded from git via `.gitignore`
- This server provides read-only access; it cannot modify your vault data

## Development

### Rebuild After Code Changes

```bash
npm install
npm run build
docker build -t onepassword-mcp .
```

### Type Checking

```bash
npx tsc --noEmit
```

### Local Development (without Docker)

Requires 1Password CLI installed locally:

```bash
npm install
npm run build
OP_SERVICE_ACCOUNT_TOKEN=ops_xxx node dist/index.js
```

## License

MIT
