# How to Connect Annabelle to Claude

This guide explains how to integrate Annabelle with **Claude Desktop** using the `Connector-MCP`. This allows you to chat with Annabelle directly from Claude's interface.

## 1. Prerequisites

*   **Annabelle Orchestrator** must be running.
    *   It typically runs on `http://localhost:8000`.
*   **Claude Desktop** app must be installed.

## 2. Build the Connector

The connector acts as a bridge between Claude and the Annabelle Orchestrator. You need to build it once.

```bash
cd Connector-MCP
npm install
npm run build
```

## 3. Configure Claude Desktop

Open your Claude Desktop configuration file:

*   **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
*   **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add the `Annabelle` entry to the `mcpServers` object in your config file. It should look like this:

```json
{
  "mcpServers": {
    "replicate": {
       ...
    },
    "Annabelle": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/Annabelle-Code/Connector-MCP/build/index.js"
      ],
      "env": {
        "ORCHESTRATOR_URL": "http://localhost:8010",
        "MCP_NAME": "Annabelle"
      }
    }
  }
}
```

> **Note:**
> 1. Replace `/ABSOLUTE/PATH/TO/...` with the real path on your machine.
> 2. `ORCHESTRATOR_URL` defaults to `http://localhost:8010` (used by `./restart.sh`). if you run `npm start` manually in the Orchestrator folder, use `http://localhost:8000`.

> **IMPORTANT:** You must replace `/ABSOLUTE/PATH/TO/Annabelle-Code/...` with the actual full path to where you cloned the repository.
>
> For example: `/Users/yourname/Coding/Annabelle-Code/Connector-MCP/dist/index.js`

## 4. Usage

1.  **Restart Claude Desktop** to load the new config.
2.  Look for the **connection icon** (plug) in Claude to confirm Annabelle is connected.
3.  Start chatting!
    *   _"Ask Annabelle to check the system status."_
    *   _"Tell Annabelle to summarize my unread emails."_

## Troubleshooting

*   **Connection Refused**: Make sure the Orchestrator is running (`npm start` in the `Orchestrator` folder) and is listening on port 8000.
*   **Tools not showing**: specific tools like `annabelle_chat` should appear in Claude's context. If not, check the Claude Desktop logs: `~/Library/Logs/Claude/mcp.log`.
