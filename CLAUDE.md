# Annabelle MCPs Monorepo

## Structure
Each subdirectory is an independent package with its own package.json.
There is no root package.json. Run npm commands inside each package directory.

## MCP Tool Pattern
**Node** MCP tools follow this pattern:
- Define zod schema for input validation
- Register via `registerTool()` from `@mcp/shared`
- Return structured objects using `StandardResponse` from `@mcp/shared`

## Testing
- Full suite: `./test.sh`
- Single Node package: `cd <Package> && npx vitest run`
- Quick health check: `./test.sh --quick`

## Scripts
- `./start-all.sh` — launch full Annabelle stack (Inngest → MCPs → Orchestrator → Thinker)
- `./test.sh` — health checks + curl tests + vitest
- `./rebuild.sh` — rebuild all packages (Shared first, then rest in parallel)
- `./restart.sh` — full restart (kill processes → rebuild → start-all.sh)

## Architecture Rules
- Guardian MCP scans inputs for prompt injection — never bypass it
- 1Password MCP is read-only by design — never add write operations
- Memorizer-MCP uses SQLite via better-sqlite3
- Orchestrator passthrough tools must stay in sync with downstream MCPs
- Each MCP should expose a `/health` endpoint (HTTP) or respond to health tool calls (stdio)
- Thinker agents support per-agent `costControls` in `agents.json` — anomaly-based spike detection with auto-pause and Telegram notification. See `Orchestrator/README.md` → "Cost Controls"

## Auto-Discovery
New MCPs are auto-discovered at Orchestrator startup via the `"annabelle"` field in `package.json`:
- Required field: `mcpName` — the logical name the Orchestrator uses
- Stdio MCPs (default): drop the folder, `npm run build`, restart Orchestrator
- Non-Node MCPs: set `command` (e.g. `".venv/bin/python"`) and optional `commandArgs` in manifest
- HTTP MCPs: also set `transport: "http"` and `httpPort`
- Disable via env: `${NAME}_MCP_ENABLED=false` (e.g. `FILER_MCP_ENABLED=false`)
- Override timeout via env: `${NAME}_MCP_TIMEOUT=60000`
- See `Orchestrator/README.md` → "Adding a New MCP" for full guide
