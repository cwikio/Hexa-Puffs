# Annabelle Connector MCP

This component is an **MCP Server** that acts as a bridge between **MCP Clients** (like Claude Desktop) and the **Annabelle Orchestrator**.

## Purpose

Standard MCPs in this repository (like `Gmail-MCP`) provide tools *to* Annabelle.
This Connector works in reverse: it exposes Annabelle's capabilities *as tools* to an MCP Client.

**Architecture:**
`Client (e.g. Claude)` <-> `Connector-MCP (stdio)` <-> `Orchestrator (HTTP)` <-> `Annabelle Agent`

## Exposed Tools

1.  **`chat`**: Sends a message to Annabelle and waits for her response.
2.  **`check_status`**: Queries the Orchestrator's health and agent status.
3.  **`check_notifications`**: Checks for asynchronous alerts (job completions, etc.).

## Setup Example: Claude Desktop

To use this with Claude, you need to add it to your `claude_desktop_config.json`.

**Prerequisite:** Ensure Annabelle Orchestrator is running (`npm start` in `Orchestrator` directory).

**Configuration:**
Add the `Annabelle` entry to your `mcpServers` list.

```json
{
  "mcpServers": {
    "existing-server": { ... },
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
> **Note:** Update `/ABSOLUTE/PATH/TO/...` to the real path on your machine.

## Troubleshooting

### 1. Connection Refused (ECONNREFUSED)
*   **Cause**: The Orchestrator is not running, or is running on a different port.
*   **Fix**:
    *   If you started Annabelle via `./restart.sh`, use `http://localhost:8010`.
    *   If you started Annabelle manually (`npm start` in `Orchestrator`), use `http://localhost:8000`.
    *   Check config in `claude_desktop_config.json`.

### 2. 401 Unauthorized
*   **Cause**: The Connector MCP cannot find the authentication token.
*   **Fix**:
    *   Ensure the file `~/.annabelle/annabelle.token` exists (created by `./restart.sh`).
    *   If you are running the Connector manually/developing, ensure `ANNABELLE_TOKEN` env var is set.
    *   *Note: Recent versions of Connector-MCP automatically look for `.annabelle/annabelle.token`.*

### 3. Tools not showing in Claude
*   **Cause**: Claude failed to load the MCP.
*   **Fix**:
    *   Check logs: `tail -f ~/Library/Logs/Claude/mcp.log`
    *   Ensure the path to `build/index.js` in your config is **absolute** and correct.
    *   Try restarting Claude Desktop completely.
