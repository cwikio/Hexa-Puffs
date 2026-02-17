# How to Connect Hexa Puffs to Claude

This guide explains how to integrate Hexa Puffs with **Claude Desktop** using the `Connector-MCP`. This allows you to chat with Hexa Puffs directly from Claude's interface.

## 1. Prerequisites

*   **Hexa Puffs Orchestrator** must be running.
    *   It typically runs on `http://localhost:8000`.
*   **Claude Desktop** app must be installed.

## 2. Build the Connector

The connector acts as a bridge between Claude and the Hexa Puffs Orchestrator. You need to build it once.

```bash
cd Connector-MCP
npm install
npm run build
```

## 3. Configure Claude Desktop

Open your Claude Desktop configuration file:

*   **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
*   **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add the `Hexa Puffs` entry to the `mcpServers` object in your config file. It should look like this:

```json
{
  "mcpServers": {
    "replicate": {
       ...
    },
    "Hexa Puffs": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/Hexa-Puffs-Code/Connector-MCP/build/index.js"
      ],
      "env": {
        "ORCHESTRATOR_URL": "http://localhost:8010",
        "MCP_NAME": "Hexa Puffs"
      }
    }
  }
}
```

> **Note:**
> 1. Replace `/ABSOLUTE/PATH/TO/...` with the real path on your machine.
> 2. `ORCHESTRATOR_URL` defaults to `http://localhost:8010` (used by `./restart.sh`). if you run `npm start` manually in the Orchestrator folder, use `http://localhost:8000`.

> **IMPORTANT:** You must replace `/ABSOLUTE/PATH/TO/Hexa-Puffs-Code/...` with the actual full path to where you cloned the repository.
>
> For example: `/Users/yourname/Coding/Hexa-Puffs-Code/Connector-MCP/dist/index.js`

## 4. Usage

1.  **Restart Claude Desktop** to load the new config.
2.  Look for the **connection icon** (plug) in Claude to confirm Hexa Puffs is connected.
3.  Start chatting!
    *   _"Ask Hexa Puffs to check the system status."_
    *   _"Tell Hexa Puffs to summarize my unread emails."_

## Troubleshooting

### 1. Connection Refused (ECONNREFUSED)
*   **Cause**: The Orchestrator is not running, or is running on a different port.
*   **Fix**:
    *   If you started Hexa Puffs via `./restart.sh`, usage `http://localhost:8010`.
    *   If you started Hexa Puffs manually (`npm start` in `Orchestrator`), usage `http://localhost:8000`.
    *   Check config in `claude_desktop_config.json`.

### 2. 401 Unauthorized
*   **Cause**: The Connector MCP cannot find the authentication token, or the token file path is incorrect.
*   **Fix**:
    *   Ensure the file `~/.hexa-puffs/hexa-puffs.token` exists (created by `./restart.sh`).
    *   If you are running the Connector manually/developing, ensure `HEXA_PUFFS_TOKEN` env var is set.
    *   *Note: Recent versions of Connector-MCP automatically look for `.hexa-puffs/hexa-puffs.token`.*

### 3. Tools not showing in Claude
*   **Cause**: Claude failed to load the MCP.
*   **Fix**:
    *   Check logs: `tail -f ~/Library/Logs/Claude/mcp.log`
    *   Ensure the path to `build/index.js` in your config is **absolute** and correct.
    *   Try restarting Claude Desktop completely (Quit -> Open).
