# External MCP System

This document describes how third-party MCP servers are integrated into the Annabelle ecosystem without modifying the core codebase. It covers the config format, loading, health monitoring, startup awareness, hot-reload, and the Thinker's system prompt integration.

---

## Table of Contents

1. [Overview](#overview)
2. [Config File Format](#config-file-format)
3. [Authorization](#authorization)
4. [Loading and Merging at Startup](#loading-and-merging-at-startup)
5. [Health Monitoring](#health-monitoring)
6. [Startup Diff and Notification](#startup-diff-and-notification)
7. [Hot-Reload](#hot-reload)
8. [Thinker System Prompt](#thinker-system-prompt)
9. [End-to-End Flow](#end-to-end-flow)
10. [File Reference](#file-reference)

---

## Overview

Internal MCPs (Guardian, Filer, Memorizer, etc.) are auto-discovered from sibling directories via the `"annabelle"` manifest in `package.json`. External MCPs are third-party servers declared in a single config file — `external-mcps.json` — in the project root. They are loaded alongside internal MCPs at startup and treated identically by the ToolRouter once connected.

Key properties of external MCPs:
- Never `required` — a failed external MCP does not block Orchestrator startup
- Not scanned by Guardian by default (Guardian config doesn't list them)
- Tracked separately via `externalMCPNames` for health reporting and diff
- Hot-reloadable — editing the config file applies changes without a restart

```
┌─────────────────────────────────────────────────────────────────┐
│                        MCPs Root Directory                       │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐     ┌──────────────┐   │
│  │ Guardian │ │  Filer   │ │ Memorizer│ ... │ Telegram-MCP │   │
│  │ (stdio)  │ │ (stdio)  │ │ (stdio)  │     │   (stdio)    │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘     └──────┬───────┘   │
│       │             │            │                   │           │
│       │  Auto-discovered via package.json "annabelle" manifest  │
│       └──────────┬──┘────────────┘───────────────────┘           │
│                  │                                               │
│                  ▼                                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  Orchestrator (:8010)                      │   │
│  │  StdioMCPClient map (internal + external, same treatment) │   │
│  └────────────────────────────────────────┬─────────────────┘   │
│                                           ▲                      │
│                  ┌────────────────────────┘                      │
│                  │                                               │
│  ┌───────────────┴──────────────────┐                           │
│  │       external-mcps.json          │                           │
│  │  { "posthog": { ... },           │                           │
│  │    "vercel": { ... } }            │                           │
│  └───────────────────────────────────┘                           │
│       Loaded via Shared/Discovery/external-loader.ts            │
│       Watched by ExternalMCPWatcher for hot-reload              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Config File Format

```
external-mcps.json  (project root)
```

The file is a JSON object where each key is the MCP's logical name and each value defines how to spawn it:

```json
{
  "posthog": {
    "command": "npx",
    "args": ["-y", "@anthropic/posthog-mcp"],
    "env": {
      "POSTHOG_HOST": "https://us.posthog.com",
      "POSTHOG_API_KEY": "${POSTHOG_API_KEY}"
    },
    "timeout": 15000,
    "sensitive": false,
    "description": "Product analytics and feature flags"
  }
}
```

### Schema

Defined in `Shared/Discovery/external-config.ts` using Zod:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `command` | string | Yes | — | Executable to spawn (e.g., `"npx"`, `"node"`, `"/usr/local/bin/mcp"`) |
| `args` | string[] | No | — | Arguments passed to the command |
| `env` | Record<string, string> | No | — | Environment variables for the spawned process |
| `timeout` | number | No | `30000` | Connection timeout in milliseconds |
| `sensitive` | boolean | No | `false` | If true, Guardian scans tool inputs for this MCP |
| `description` | string | No | — | Human-readable description (shown in startup notification) |

### Environment Variable Resolution

Env values support `${ENV_VAR}` placeholders that resolve to `process.env` values at load time:

```json
{
  "env": {
    "API_KEY": "${POSTHOG_API_KEY}",
    "STATIC": "no-substitution",
    "MIXED": "prefix-${POSTHOG_API_KEY}-suffix"
  }
}
```

- `${POSTHOG_API_KEY}` resolves to `process.env.POSTHOG_API_KEY`
- Missing env vars resolve to empty string (no error)
- Only `${UPPER_SNAKE_CASE}` patterns are matched

### Enforced Constraints

All external MCPs are forced to `required: false`. A failed external MCP is logged but does not prevent the Orchestrator from starting. If an external MCP's name conflicts with an internal MCP, it is skipped with a warning.

---

## Authorization

External MCPs authenticate with their upstream services using **API keys or tokens** passed as environment variables. The Orchestrator does not handle OAuth browser flows — tokens are obtained once from each provider's dashboard and stored as environment variables.

### How It Works

1. The MCP's `env` field in `external-mcps.json` references tokens via `${ENV_VAR}` placeholders
2. At spawn time, the Orchestrator resolves these from `process.env`
3. The spawned MCP process receives the resolved values and uses them to authenticate with its API

### Token Setup Per Provider

| Provider | Where to Get Token | Env Var | Notes |
| -------- | ------------------ | ------- | ----- |
| PostHog | Project Settings > Personal API Keys (use "MCP Server" preset) | `POSTHOG_PERSONAL_API_KEY` | Scoped to read access + feature flag writes |
| Neon | Console > Account Settings > API Keys | `NEON_API_KEY` | 64-bit token, valid until revoked |
| Vercel | Account Settings > Tokens | `VERCEL_API_TOKEN` | Can be scoped to specific teams |
| GitHub | Settings > Developer Settings > Personal Access Tokens | `GITHUB_TOKEN` | Fine-grained tokens recommended |

### Step-by-Step

1. **Get the token** from the provider's dashboard (see table above)
2. **Export it** in your shell profile (`~/.zshrc`, `~/.bashrc`, etc.):

   ```bash
   export POSTHOG_PERSONAL_API_KEY="phx_abc123..."
   ```

3. **Reference it** in `external-mcps.json`:

   ```json
   {
     "posthog": {
       "command": "npx",
       "args": ["-y", "@anthropic/posthog-mcp"],
       "env": {
         "POSTHOG_PERSONAL_API_KEY": "${POSTHOG_PERSONAL_API_KEY}"
       }
     }
   }
   ```

4. **Restart the Orchestrator** (or let hot-reload pick up the change)

### Security Notes

- Tokens live in environment variables, not in `external-mcps.json` — the config file only contains `${PLACEHOLDER}` references, safe to commit
- Missing env vars resolve to empty string at load time (the MCP will fail to authenticate, not crash the Orchestrator)
- Use the narrowest token scope available (e.g., PostHog's "MCP Server" preset, GitHub fine-grained tokens)
- Rotate tokens periodically via the provider's dashboard — update the env var and restart

### OAuth-Only Providers

Most developer-focused MCPs (PostHog, Neon, Vercel, GitHub, Supabase, Cloudflare, Linear) support static API keys. OAuth browser flows are **not currently supported** by the Orchestrator. If a future MCP requires OAuth exclusively, the planned approach is a CLI command (`annabelle auth <mcp>`) that opens a browser, captures the callback, and stores the token in `~/.annabelle/tokens/`.

---

## Loading and Merging at Startup

```
Orchestrator/src/config/index.ts — loadConfig()
Shared/Discovery/external-loader.ts — loadExternalMCPs()
```

At Orchestrator startup, `loadConfig()` runs auto-discovery for internal MCPs, then merges external MCPs from `external-mcps.json`:

```
1. scanForMCPs(mcpsRoot)              → internal MCP configs
2. loadExternalMCPs('external-mcps.json')  → external MCP configs
3. For each external MCP:
   a. Check for name conflict with internal MCPs → skip if conflict
   b. Merge into mcpServersStdio map
   c. Track name in externalMCPNames array
4. If sensitive: true → add prefix pattern to sensitiveTools list
```

After config loads, the Orchestrator initializes all MCPs identically — `StdioMCPClient` is created for each entry in `mcpServersStdio`, whether internal or external.

### Graceful Failure

The loader never throws. All error paths return an empty record:
- File doesn't exist → `{}`
- Invalid JSON → `{}` (logged as error)
- Schema validation fails → `{}` (logged with Zod error details)
- File read error → `{}` (logged as warning)

---

## Health Monitoring

```
Orchestrator/src/tools/health-check.ts — system_health_check tool
Orchestrator/src/core/orchestrator.ts — checkMCPHealth()
```

The `system_health_check` tool exposes per-MCP health status with internal/external classification:

```json
{
  "scope": "all",
  "summary": { "total": 8, "healthy": 7, "unhealthy": 1 },
  "mcps": [
    { "name": "guardian", "available": true, "healthy": true, "type": "internal" },
    { "name": "memory", "available": true, "healthy": true, "type": "internal" },
    { "name": "posthog", "available": true, "healthy": false, "type": "external" }
  ]
}
```

The tool accepts a `scope` parameter: `"all"` (default), `"internal"`, or `"external"`.

### How Classification Works

The Orchestrator maintains a mutable `Set<string>` called `externalMCPNames`. When `checkMCPHealth()` iterates over `stdioClients`, it checks membership in this set to classify each MCP.

The set is mutable (not derived from frozen config) because hot-reload can add or remove external MCPs at runtime.

### Periodic Health Checks

Every 60 seconds, the Orchestrator runs `runHealthChecks()` on all stdio clients. If a client fails its health check:
1. Attempt `client.restart()`
2. If restart succeeds, re-register with ToolRouter and rediscover tools
3. If restart fails, log as error — service stays unavailable

This applies to both internal and external MCPs.

---

## Startup Diff and Notification

### Snapshot Persistence

```
Orchestrator/src/core/startup-diff.ts
~/.annabelle/last-known-mcps.json
```

On every boot, the Orchestrator:
1. Builds a snapshot of all currently loaded MCPs (name + internal/external type)
2. Loads the previous snapshot from `~/.annabelle/last-known-mcps.json`
3. Computes the diff (which MCPs were added or removed since last boot)
4. Saves the current snapshot for next boot

Snapshot format:

```json
{
  "timestamp": "2025-06-15T10:30:00.000Z",
  "mcps": [
    { "name": "guardian", "type": "internal" },
    { "name": "memory", "type": "internal" },
    { "name": "posthog", "type": "external" }
  ]
}
```

If no previous snapshot exists (first boot), the diff is empty (no false positives).

### Startup Notification

```
Orchestrator/src/core/orchestrator.ts — sendStartupNotification()
```

After initialization completes, the Orchestrator sends a Telegram message summarizing the boot:

```
Orchestrator started
MCPs: 8 total (6 internal, 2 external)

External:
  posthog: 15 tools — Product analytics and feature flags
    • query-run
    • insight-create-from-query
    • insight-get
    • insight-update
    • ...
  vercel: 12 tools — Vercel project management and deployments
    • search_documentation
    • list_projects
    • get_project
    • list_deployments
    • ...

Changes since last boot:
  + posthog
  - neon

Failed: browser
```

The message includes:
- Total MCP count with internal/external breakdown
- External MCP details: tool count per MCP, description (if set)
- Diff: added and removed MCPs since last boot
- Failed MCPs (if any didn't initialize)

### Chat ID Resolution

The notification is sent to the chat ID configured for the `annabelle` agent in `agents.json`:

```
agentDef.costControls.notifyChatId || process.env.NOTIFY_CHAT_ID
```

If neither is set, the notification is silently skipped. The notification is non-blocking (fire-and-forget with error logging) — Telegram being down does not affect startup.

---

## Hot-Reload

```
Orchestrator/src/core/external-watcher.ts — ExternalMCPWatcher
Orchestrator/src/core/orchestrator.ts — handleExternalMCPChange()
```

The Orchestrator watches `external-mcps.json` for changes using `fs.watch()`. When the file is modified, added or removed MCPs are detected and applied without a restart.

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                  ExternalMCPWatcher                                │
│                                                                   │
│  fs.watch('external-mcps.json')                                   │
│       │                                                           │
│       │ file change event (debounced 500ms)                       │
│       ▼                                                           │
│  loadExternalMCPs(configPath)      ← re-read file                │
│       │                                                           │
│       ▼                                                           │
│  Compare fresh entries vs current state                           │
│       │                                                           │
│       ├── New entries → added: Map<name, config>                  │
│       └── Missing entries → removed: string[]                     │
│                │                                                  │
│                ▼                                                  │
│  onChanged(added, removed)         ← callback to Orchestrator    │
└──────────────────────────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────┐
│            Orchestrator.handleExternalMCPChange()                  │
│                                                                   │
│  For each removed MCP:                                            │
│    1. client.close()               ← terminate child process     │
│    2. stdioClients.delete(name)                                   │
│    3. toolRouter.unregisterMCP(name)                              │
│    4. externalMCPNames.delete(name)                               │
│                                                                   │
│  For each added MCP:                                              │
│    1. Check name conflict with internal MCP → skip if conflict   │
│    2. new StdioMCPClient(name, config)                            │
│    3. client.initialize()          ← spawn process + handshake   │
│    4. maybeGuard(name, client)     ← wrap with Guardian if conf  │
│    5. toolRouter.registerMCP(name, client)                        │
│    6. stdioClients.set(name, client)                              │
│    7. externalMCPNames.add(name)                                  │
│                                                                   │
│  After all changes:                                               │
│    1. toolRouter.discoverTools()   ← rebuild all routes          │
│    2. saveSnapshot()               ← persist for next boot diff  │
│    3. sendHotReloadNotification()  ← Telegram message            │
└──────────────────────────────────────────────────────────────────┘
```

### Debouncing

Text editors often fire multiple file system events on a single save (write temp file, rename, etc.). The watcher debounces with a 500ms timer — only the last event in a burst triggers a reload.

### State Tracking

The watcher maintains its own `Map<string, ExternalMCPEntry>` of current external MCPs. This is updated before calling the `onChanged` callback, so subsequent file changes correctly diff against the latest state (not the original startup state).

### Route Rebuilding

`toolRouter.discoverTools()` clears all routes and rebuilds from all registered MCPs. This is the same pattern used by the periodic health checker when it restarts a crashed MCP. The operation is fast (~2-3ms) since it just calls `client.listTools()` on each connected MCP.

### Hot-Reload Notification

When MCPs change at runtime, a Telegram message is sent:

```
External MCPs changed:
  + posthog: 15 tools — Product analytics and feature flags
    • query-run
    • insight-create-from-query
    • insight-get
    • insight-update
    • ...
  - neon
```

### Thinker Tool Refresh

The Thinker has a 10-minute TTL cache for the tool list fetched from the Orchestrator (`GET /tools/list`). After a hot-reload, new tools become available to the Thinker within at most 10 minutes — no Thinker restart needed.

### Cleanup on Shutdown

`Orchestrator/src/index.ts` calls `stopExternalMCPWatcher()` during graceful shutdown (SIGINT/SIGTERM), which closes the `fs.watch()` handle and clears any pending debounce timer.

---

## Thinker System Prompt

```
Thinker/prompts/default-system-prompt.md (file-based, loaded at startup)
Thinker/src/agent/loop.ts:45-47 — DEFAULT_SYSTEM_PROMPT (hardcoded fallback)
```

The Thinker's system prompt includes two sections relevant to external MCPs:

**Status & Health Queries:**
> When the user asks about your status or system status — call get_status for a quick overview.
> For a deeper check (are services actually responding?), use system_health_check. It pings every connected MCP and reports per-service health, classified as internal or external.

**External Services:**
> In addition to built-in MCPs (memory, search, email, Telegram, etc.), external services can be connected by adding entries to external-mcps.json in the project root. External MCPs are loaded when the Orchestrator starts — changes to the config file are picked up automatically without a restart. Use system_health_check to see what's currently connected. If the user asks about connecting a new service, tell them it can be added to external-mcps.json.

This gives the agent awareness that:
1. `system_health_check` exists and shows internal/external classification
2. External services are configurable via a file (user can ask about adding new ones)
3. Changes are picked up without a restart (hot-reload)

---

## End-to-End Flow

### Adding a New External MCP

```
1. User edits external-mcps.json:
   { "posthog": { "command": "npx", "args": ["-y", "@anthropic/posthog-mcp"], ... } }

2. ExternalMCPWatcher detects file change (500ms debounce)

3. Orchestrator.handleExternalMCPChange() runs:
   a. Spawns StdioMCPClient for "posthog"
   b. Registers with ToolRouter
   c. Rebuilds all routes via discoverTools()
   d. Saves snapshot to ~/.annabelle/last-known-mcps.json
   e. Sends Telegram: "External MCPs changed: + posthog: 15 tools"

4. Within 10 minutes, Thinker refreshes its tool cache
   → posthog_* tools appear in tool selection

5. User asks "what's our signup funnel look like?"
   → Thinker selects posthog_* tools via embedding similarity
   → LLM calls posthog_insight_query
   → Result returned to user
```

### Removing an External MCP

```
1. User removes "posthog" entry from external-mcps.json

2. ExternalMCPWatcher detects change

3. Orchestrator.handleExternalMCPChange():
   a. Calls posthog client.close() (terminates child process)
   b. Removes from stdioClients, toolRouter, externalMCPNames
   c. Rebuilds routes
   d. Saves snapshot
   e. Sends Telegram: "External MCPs changed: - posthog"

4. Thinker refreshes → posthog_* tools no longer available
```

### Boot with Changed MCPs

```
1. User adds "vercel" and removes "neon" from external-mcps.json

2. User restarts Orchestrator (or system reboots)

3. loadConfig() loads external-mcps.json
   → "vercel" merged into mcpServersStdio
   → "neon" absent

4. Orchestrator.initialize():
   a. Spawns all MCPs (internal + external)
   b. discoverTools()
   c. computeStartupDiff():
      - Loads previous snapshot (had "neon", no "vercel")
      - Current snapshot has "vercel", no "neon"
      - Diff: added=["vercel"], removed=["neon"]
      - Saves new snapshot
   d. sendStartupNotification():
      "Orchestrator started
       MCPs: 8 total (6 internal, 2 external)
       External:
         vercel: 8 tools
       Changes since last boot:
         + vercel
         - neon"
   e. startExternalMCPWatcher() → watches for future changes
```

---

## File Reference

| Component | File | Description |
|-----------|------|-------------|
| Config schema | `Shared/Discovery/external-config.ts` | Zod schema for `external-mcps.json` entries |
| Config loader | `Shared/Discovery/external-loader.ts` | Reads file, validates, resolves env vars |
| Orchestrator config | `Orchestrator/src/config/index.ts` | Merges external MCPs into stdio config |
| Stdio config schema | `Orchestrator/src/config/schema.ts` | `StdioMCPServerConfigSchema` with `description` field |
| Startup diff | `Orchestrator/src/core/startup-diff.ts` | Snapshot save/load/diff logic |
| External watcher | `Orchestrator/src/core/external-watcher.ts` | `fs.watch()` with debounce and diff |
| Orchestrator core | `Orchestrator/src/core/orchestrator.ts` | `computeStartupDiff()`, `sendStartupNotification()`, `handleExternalMCPChange()` |
| Tool router | `Orchestrator/src/routing/tool-router.ts` | `registerMCP()`, `unregisterMCP()`, `discoverTools()` |
| Health check tool | `Orchestrator/src/tools/health-check.ts` | `system_health_check` with scope filter |
| Shutdown cleanup | `Orchestrator/src/index.ts` | `stopExternalMCPWatcher()` on SIGINT/SIGTERM |
| System prompt | `Thinker/src/agent/loop.ts` | "External Services" and "Status & Health Queries" sections |
| Snapshot file | `~/.annabelle/last-known-mcps.json` | Persisted MCP snapshot between boots |
| Config file | `external-mcps.json` (project root) | User-editable external MCP declarations |
| Tests | `Shared/tests/external-loader.test.ts` | Loader: parsing, env resolution, description passthrough |
| Tests | `Orchestrator/tests/unit/startup-diff.test.ts` | Snapshot save/load/diff logic |
| Tests | `Orchestrator/tests/unit/external-watcher.test.ts` | File watching, debounce, add/remove detection |
| Tests | `Orchestrator/tests/unit/health-check.test.ts` | Health check tool with scope filtering |
