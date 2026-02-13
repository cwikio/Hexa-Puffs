# Changelog

All notable changes to the Annabelle MCP ecosystem are documented here.
Organized by system version with per-package sections.

## [1.1.0] - 2026-02-12

### LinkedIn-MCP (NEW)
- First non-Node MCP — Python 3.11+ using FastMCP and `linkedin-api`
- Tools: `get_profile`, `get_own_profile`, `get_conversations`, `get_conversation`, `send_message`, `get_feed`, `create_post`, `search_people`, `search_companies`, `get_connections`, `send_connection_request`
- Conversation participant resolution fallback via `_resolve_via_conversations()` when search API is rate-limited
- Auto-discovered by Orchestrator via `command: ".venv/bin/python"` in manifest

### Memorizer-MCP
- Added `query_timeline` tool — cross-source temporal queries ("what happened last week?") across facts, conversations, profile changes, skills, contacts, and projects
- Added `create_contact`, `list_contacts`, `update_contact` tools
- Added `create_project`, `list_projects`, `update_project` tools

### Thinker
- **Sliding tools** — tools used in recent turns are "sticky" and auto-injected into follow-up messages, enabling context like "what about the other one?" (`THINKER_STICKY_TOOLS_LOOKBACK`, `THINKER_STICKY_TOOLS_MAX`)
- **Post-conversation fact extraction** — idle timer triggers automatic fact extraction from recent turns after user goes quiet (`factExtraction.idleMs`, `factExtraction.confidenceThreshold`)
- **Hallucination guard** — detects when LLM claims action without calling tools, retries with `toolChoice: 'required'`
- **Tool recovery** — detects tool calls leaked as text by LLMs (common with Groq/Llama) and executes them
- **Temperature modulation** — lowers temperature to 0.3 when embedding selector has high confidence
- **Playbook tool injection** — playbooks declare `required_tools` that are force-included even if embedding selector would miss them
- Added `vercel-deployments` and updated `email-classify`, `cron-scheduling`, `web-browsing` playbooks (now 15 total)
- LinkedIn keyword route added to tool selector

### Orchestrator
- **External MCP system** — third-party MCPs declared in `external-mcps.json`, loaded at startup, hot-reloaded via `ExternalMCPWatcher` file watcher
- **`/diagnose` command** — 22 automated diagnostic checks (MCP health, Ollama connectivity, disk space, error baselines, cron health, etc.)
- **Startup diff notification** — detects MCP/tool changes since last boot and sends summary via Telegram
- Added LinkedIn and CodeExec to Guardian scanning config
- Updated tool router with LinkedIn tool group

### Gmail-MCP
- `modify_labels` now accepts label names (case-insensitive) in addition to label IDs, with automatic name-to-ID resolution

### Shared
- Added `command` and `commandArgs` fields to `AnnabelleManifest` for non-Node MCP support
- Added `external-loader.ts` and `external-config.ts` for loading external MCP configs

### Guardian
- Updated scanning table: LinkedIn (`input: false, output: false`), CodeExec (`input: true, output: false`)

---

## [1.0.0] - 2026-02-10

First versioned release. Establishes baseline after completing architecture review items S1-S5, P1-P5, R1-R4, A5-A7.

### Shared
- Added generic `registerTool<T>()` — handlers now receive Zod-inferred types instead of `Record<string, unknown>` (A4)
- Extracted shared test helpers to `Shared/Testing/` (A5)
- Unified Zod to `^3.24.0` across all packages (A6)
- Unified Node engine constraint to `>=22.0.0` (A7)

### Gmail-MCP
- Migrated to canonical `StandardResponse` from `@mcp/shared` — removed local duplicate missing `errorCode`/`errorDetails` (A1)

### Orchestrator
- Added system version to `/health` endpoint
- Derived sensitive tools from MCP manifest `sensitive` flag instead of hardcoded list (A2)
- Added HTTP body size limit (S4), rate limiting (S5), retry logic with backoff (P1), connection pooling (P2)
- Deep health checks (R2), graceful shutdown (R3), exponential backoff for agent restart (R4)

### CodeExec-MCP, Filer-MCP, Searcher-MCP, Onepassword-MCP, Guardian, Telegram-MCP
- Removed `as FooInput` type casts from all `registerTool()` handlers — now type-safe via generic (A4)

### Thinker
- Bound to `127.0.0.1` (S2), tool cache TTL (P4), embedding-based tool selection
- Embedding cache persistence — tool embeddings cached to `~/.annabelle/data/embedding-cache.json`, base64-encoded Float32Array with provider/model invalidation. Eliminates ~13s cold start on restart (N6)
- Tool hot-reload — `refreshToolsIfNeeded()` detects Orchestrator tool set changes before each message, incrementally re-embeds only new tools (N1)
- Embedding selector observability — `ToolSelectionStats` with method, scores, threshold, top tools; exposed via `/health` endpoint and WARN/DEBUG logs (N2)

### Memorizer-MCP
- Added SQLite `busy_timeout` (P3)

### Security (all packages)
- Localhost-only CORS + `X-Annabelle-Token` header support (S1)
- Auth bypass warning when `ANNABELLE_TOKEN` unset (S3)
