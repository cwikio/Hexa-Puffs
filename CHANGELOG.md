# Changelog

All notable changes to the Annabelle MCP ecosystem are documented here.
Organized by system version with per-package sections.

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

### Memorizer-MCP
- Added SQLite `busy_timeout` (P3)

### Security (all packages)
- Localhost-only CORS + `X-Annabelle-Token` header support (S1)
- Auth bypass warning when `ANNABELLE_TOKEN` unset (S3)
