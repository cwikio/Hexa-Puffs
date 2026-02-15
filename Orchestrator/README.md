# Annabelle Orchestrator MCP

The central orchestration layer for Annabelle AI Assistant. The Orchestrator acts as an **agent router and protocol bridge** that:

- Accepts MCP stdio connections from Claude Desktop/Code
- Spawns and manages multiple Thinker agent instances (multi-agent)
- Polls Telegram channels and dispatches messages to agents via channel bindings
- Enforces per-agent tool policies (allow/deny glob patterns)
- Spawns and manages downstream MCPs via stdio
- Connects to independent HTTP MCP services (Searcher, Gmail)
- Auto-discovers new MCPs from sibling directories via `annabelle` manifest in `package.json`

## Architecture

```
┌─────────────────────────┐
│   Claude Desktop/Code   │
│   (MCP client)          │
└───────────┬─────────────┘
            │ stdio
            ↓
┌───────────────────────────────────────────────────────────────────┐
│                   ORCHESTRATOR MCP (:8010)                         │
│                                                                    │
│  HTTP REST API: /health, /tools/list, /tools/call,                │
│                 /agents/:id/resume                                 │
│  MCP stdio: Standard MCP protocol for Claude Desktop              │
│  65+ Tools (passthrough from downstream MCPs)                     │
│                                                                    │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │               MULTI-AGENT LAYER                            │    │
│  │                                                            │    │
│  │  ChannelPoller ──→ MessageRouter ──→ AgentManager          │    │
│  │  (polls Telegram)  (channel→agent)  (spawn/health/restart) │    │
│  │                                                            │    │
│  │  Per-agent tool policies (allowedTools / deniedTools)      │    │
│  │  Per-agent Guardian scan overrides                         │    │
│  └───────────────────────────────┬───────────────────────────┘    │
│                                  │ HTTP dispatch                   │
│                        ┌─────────┼─────────┐                      │
│                        ↓                   ↓                      │
│                   ┌─────────┐         ┌─────────┐                 │
│                   │ Thinker │         │ Thinker │  ...             │
│                   │ :8006   │         │ :8007   │                  │
│                   │ agent-1 │         │ agent-2 │                  │
│                   └─────────┘         └─────────┘                 │
│                                                                    │
└───────────────┬──────────────────────────────┬────────────────────┘
                │ stdio (spawns children)       │ HTTP
                ↓                               ↓
┌──────────────────────────────────┐  ┌────────────────────────┐
│  STDIO MCP SERVERS (spawned)     │  │  HTTP MCP SERVICES     │
│  ┌────────┐ ┌────────┐          │  │  ┌──────────┐          │
│  │Guardian│ │Telegram│          │  │  │ Searcher │          │
│  │(stdio) │ │(stdio) │          │  │  │ (:8007)  │          │
│  └────────┘ └────────┘          │  │  └──────────┘          │
│  ┌────────┐ ┌────────┐          │  │  ┌──────────┐          │
│  │1Pass   │ │ Filer  │          │  │  │  Gmail   │          │
│  │(stdio) │ │(stdio) │          │  │  │ (:8008)  │          │
│  └────────┘ └────────┘          │  │  └──────────┘          │
│  ┌────────┐                      │  │                        │
│  │Memory  │ ┌────────┐           │  │                        │
│  │(stdio) │ │CodeExec│           │  │                        │
│  └────────┘ │(stdio) │           │  │                        │
│             └────────┘           │  │                        │
└──────────────────────────────────┘  └────────────────────────┘
```

## Adding a New MCP

The Orchestrator **auto-discovers** MCP servers from sibling directories at startup. No hardcoded config changes needed.

### Steps

1. **Create your MCP directory** as a sibling folder (e.g., `MCPs/MyNewMCP/`)
2. **Add an `annabelle` manifest** to your `package.json`:

```json
{
  "name": "my-new-mcp",
  "main": "dist/index.js",
  "annabelle": {
    "mcpName": "mynewmcp"
  }
}
```

3. **Set the `main` field** to point to your compiled entry point
4. **Build** your MCP: `npm run build`
5. **Restart Orchestrator** — it auto-discovers the MCP and registers its tools

### Manifest Fields

| Field | Required | Default | Description |
|---|---|---|---|
| `mcpName` | Yes | — | Logical name used by Orchestrator (e.g., `filer`, `memory`) |
| `transport` | No | `"stdio"` | `"stdio"` (spawned by Orchestrator) or `"http"` (independent service) |
| `sensitive` | No | `false` | Whether Guardian should wrap this MCP for security scanning |
| `role` | No | — | Set to `"guardian"` only for the Guardian MCP |
| `timeout` | No | `30000` | Default timeout in milliseconds |
| `required` | No | `false` | If `true`, Orchestrator fails startup when this MCP is unavailable |
| `httpPort` | No | — | Port for HTTP transport MCPs (ignored for stdio) |
| `label` | No | capitalize(mcpName) | Pretty display name (e.g., "1Password", "Web Search") |
| `toolGroup` | No | same as label | Semantic group tag for tool descriptions (e.g., "Communication") |
| `keywords` | No | — | Keywords that trigger Thinker tool selection (e.g., `["email", "inbox"]`) |
| `guardianScan` | No | `{input: true, output: true}` | Per-MCP Guardian scan overrides |

All metadata fields are optional. Omitting them triggers auto-generated fallbacks — a new MCP works without any metadata.

### HTTP MCP Example

For MCPs that run as independent HTTP services (rare — only needed for webhooks, OAuth, or long-running connections):

```json
{
  "name": "my-http-mcp",
  "main": "dist/index.js",
  "annabelle": {
    "mcpName": "myhttp",
    "transport": "http",
    "httpPort": 8009
  }
}
```

HTTP MCPs must be started separately before the Orchestrator.

### Environment Variable Overrides

Each discovered MCP supports env var overrides using the uppercase MCP name as prefix:

| Variable | Description |
|---|---|
| `${NAME}_MCP_ENABLED` | Set to `false` to disable a discovered MCP |
| `${NAME}_MCP_TIMEOUT` | Override the default timeout (ms) |
| `${NAME}_MCP_PORT` | Override the HTTP port (HTTP MCPs only) |
| `${NAME}_MCP_URL` | Override the full URL (HTTP MCPs only) |

Example: `SEARCHER_MCP_ENABLED=false` disables the Searcher MCP.

### How Discovery Works

At startup, the Orchestrator's scanner:

1. Reads each sibling directory's `package.json`
2. Skips directories without an `annabelle.mcpName` field (Orchestrator, Shared, Thinker, etc.)
3. Resolves the entry point from the `main` field
4. Builds stdio or HTTP client configs based on `transport`
5. Guardian (if present) is always initialized first so it can wrap other MCPs

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your settings
```

### 3. Launch the stack (recommended)

The recommended way to start everything is using the launch script, which starts:

- Orchestrator (port 8010) - spawns stdio MCPs, connects to HTTP MCPs, spawns Thinker agents
- Searcher (port 8007) - web search (must be started separately)
- Gmail (port 8008) - email management (must be started separately)
- Inngest Dev Server (port 8288) - job management dashboard

```bash
cd <repo-root>
./start-all.sh
```

This script:

1. Starts Inngest Dev Server
2. Starts Orchestrator with `TRANSPORT=http PORT=8010 MCP_CONNECTION_MODE=stdio`
3. Orchestrator automatically spawns: Telegram, Memory, Filer, Guardian, 1Password MCPs
4. Orchestrator connects to HTTP services: Searcher (:8007), Gmail (:8008)
5. Orchestrator spawns Thinker agent(s) via AgentManager (or connects to single Thinker at `THINKER_URL`)
6. If `CHANNEL_POLLING_ENABLED=true`, Orchestrator polls Telegram and dispatches messages to agents

### 4. Run Orchestrator manually (alternative)

```bash
# Development mode (stdio for Claude Desktop)
npm run dev

# HTTP mode with stdio to downstream MCPs (for Thinker)
TRANSPORT=http PORT=8010 MCP_CONNECTION_MODE=stdio npm start

# Production build
npm run build
npm start
```

## Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "annabelle": {
      "command": "node",
      "args": ["/path/to/MCPs/Orchestrator/dist/Orchestrator/src/index.js"],
      "env": {
        "MCP_CONNECTION_MODE": "stdio"
      }
    }
  }
}
```

Or using tsx for development:

```json
{
  "mcpServers": {
    "annabelle": {
      "command": "npx",
      "args": ["tsx", "/path/to/MCPs/Orchestrator/src/index.ts"],
      "env": {
        "MCP_CONNECTION_MODE": "stdio"
      }
    }
  }
}
```

**Note:** With `MCP_CONNECTION_MODE=stdio`, Orchestrator spawns all downstream MCPs as child processes via stdio. No separate HTTP ports are needed for downstream MCPs.

## Multi-Agent Architecture

The Orchestrator manages multiple Thinker agent instances, each running as a separate process with its own LLM config, system prompt, and tool permissions. Agents are **lazy-spawned** on first message and **idle-killed** after inactivity.

### Message Flow

1. **Orchestrator polls Telegram** via `ChannelPoller` (replaces Thinker's old direct polling)
2. **MessageRouter** resolves which agent handles each message based on channel bindings
3. **AgentManager.ensureRunning()** lazy-spawns the agent if not already running (deduplicates concurrent requests)
4. **Orchestrator dispatches** the message to the resolved agent via HTTP POST
5. **Orchestrator delivers** the response back to Telegram and stores it in Memory
6. **Idle scanner** (every 5 min) kills agents with no activity beyond their `idleTimeoutMinutes`

```
Telegram message arrives
       ↓
ChannelPoller picks it up
       ↓
MessageRouter resolves agent (exact chatId → wildcard → default)
       ↓
AgentManager.ensureRunning(agentId)  ← lazy-spawn if stopped
       ↓
AgentManager.getClient(agentId).processMessage(msg)
       ↓
Thinker runs ReAct loop, calls tools via Orchestrator
       ↓
Orchestrator enforces tool policy (allowedTools/deniedTools)
       ↓
Response sent back to Telegram by Orchestrator
```

### Agent Configuration

Agents are defined in a JSON config file (set via `AGENTS_CONFIG_PATH` env var):

```json
{
  "agents": [
    {
      "agentId": "annabelle",
      "enabled": true,
      "port": 8006,
      "llmProvider": "groq",
      "model": "llama-3.3-70b-versatile",
      "systemPrompt": "",
      "allowedTools": [],
      "deniedTools": [],
      "maxSteps": 8,
      "costControls": {
        "enabled": true,
        "shortWindowMinutes": 2,
        "spikeMultiplier": 3.0,
        "hardCapTokensPerHour": 250000,
        "minimumBaselineTokens": 1000,
        "notifyChatId": "<YOUR_TELEGRAM_CHAT_ID>"
      }
    }
  ],
  "bindings": [
    { "channel": "telegram", "chatId": "*", "agentId": "annabelle" }
  ]
}
```

**Agent definition fields:**

| Field | Description |
| ----- | ----------- |
| `agentId` | Unique identifier |
| `port` | HTTP port for this Thinker instance |
| `llmProvider` | `groq`, `lmstudio`, or `ollama` |
| `model` | Provider-specific model name |
| `systemPrompt` | Custom persona/instructions |
| `allowedTools` | Glob patterns of permitted tools (empty = all) |
| `deniedTools` | Glob patterns of denied tools (evaluated after allow) |
| `maxSteps` | Max ReAct steps per message (1-50) |
| `idleTimeoutMinutes` | Minutes of inactivity before idle-kill (default: 30) |
| `costControls` | Optional cost control config (see below) |

### Cost Controls

Per-agent LLM cost controls that detect abnormal token consumption spikes and pause the agent. When triggered, Orchestrator sends a Telegram alert and stops dispatching messages to the paused agent.

Add a `costControls` block to an agent definition:

```json
{
  "agentId": "annabelle",
  "port": 8006,
  "costControls": {
    "enabled": true,
    "shortWindowMinutes": 2,
    "spikeMultiplier": 3.0,
    "hardCapTokensPerHour": 500000,
    "minimumBaselineTokens": 1000,
    "notifyChatId": "12345"
  }
}
```

| Field | Default | Description |
| ----- | ------- | ----------- |
| `enabled` | `false` | Enable cost monitoring for this agent |
| `shortWindowMinutes` | `2` | Short window size for spike detection (1-30) |
| `spikeMultiplier` | `3.0` | Spike threshold: short-window rate must exceed baseline x this (1.5-10) |
| `hardCapTokensPerHour` | `500000` | Absolute safety cap: max tokens in any 60-minute window (min 10000) |
| `minimumBaselineTokens` | `1000` | Minimum baseline tokens before spike detection activates (min 100) |
| `notifyChatId` | _(none)_ | Telegram chat ID for cost alert notifications (falls back to message sender) |

**How it works:**

1. Orchestrator passes cost config to Thinker via environment variables at spawn time
2. Thinker's `CostMonitor` tracks tokens in a 60-bucket sliding window (1 bucket/minute)
3. After each LLM call, if a spike or hard cap is detected, Thinker pauses and returns `{ paused: true }`
4. Orchestrator marks the agent paused, sends a Telegram notification, and stops dispatching new messages
5. Resume via `POST /agents/:agentId/resume` (see REST API below)

### Channel Bindings

Bindings map `(channel, chatId)` pairs to agents. Resolution order:

1. **Exact match** — `channel` + `chatId` both match
2. **Wildcard** — `channel` matches, `chatId` is `*`
3. **Default** — falls back to the first available agent

### Tool Policy Enforcement

When a Thinker agent calls a tool via `POST /tools/call`, Orchestrator checks the agent's `allowedTools` and `deniedTools` before routing:

- `allowedTools: ["telegram_*", "memory_*"]` — only these patterns are permitted
- `deniedTools: ["telegram_delete_*"]` — these patterns are blocked even if allowed
- Empty `allowedTools` = all tools permitted (only `deniedTools` evaluated)

Glob matching uses `*` as a wildcard (e.g., `gmail_*` matches `gmail_send_email`).

### Subagent Spawning

Agents can spawn temporary subagent processes for parallel task delegation via the `spawn_subagent` tool.

**How it works:**

1. Agent calls `spawn_subagent` with a task description and optional tool/model overrides
2. `AgentManager.spawnSubagent()` creates a new Thinker process with `port: 0` (OS-assigned dynamic port)
3. The subagent announces its actual port via `LISTENING_PORT=XXXXX` on stdout
4. The task is dispatched to the subagent; the tool call **blocks until the subagent finishes**
5. The subagent is immediately killed and cleaned up after returning its result

**Safety features:**

- **Single-level depth** — subagents cannot spawn their own subagents (`spawn_subagent` auto-denied)
- **Max 5 concurrent** per parent agent
- **Tool policy inheritance** — subagent tools are a subset of parent's, `deniedTools` are merged
- **Cascade-kill** — stopping a parent kills all child subagents
- **Auto-kill timer** — subagents that exceed their timeout (default 5 min, max 30) are forcefully killed

### Lazy-Spawn / Idle-Kill

Agents are registered on startup but not spawned until their first message arrives. This reduces resource usage when agents aren't active.

- **`ensureRunning(agentId)`** — lazy-spawns with deduplication (concurrent callers share one spawn)
- **Idle scanner** runs every 5 minutes, kills agents with no activity beyond their `idleTimeoutMinutes` (default: 30)
- **Agent states:** `stopped` → `starting` → `running` → `stopping` → `stopped`
- Subagents are excluded from idle scanning (they have their own auto-kill timer)

### Single-Agent Fallback

If no `agents` config or `AGENTS_CONFIG_PATH` is set, Orchestrator falls back to connecting to a single Thinker at `THINKER_URL` (default `http://localhost:8006`). This preserves backward compatibility.

## Thinker Integration

Each Thinker instance is a passive agent runtime. It does NOT poll Telegram directly — Orchestrator handles all channel I/O.

Thinker exposes these HTTP endpoints:

- `POST /process-message` — Process a dispatched message (called by Orchestrator)
- `POST /execute-skill` — Execute a proactive task
- `GET /health` — Health check
- `GET /cost-status` — Get cost monitor state (tokens used, rates, pause status)
- `POST /cost-resume` — Resume a cost-paused agent (`{ resetWindow: true }` to clear token history)

Thinker discovers tools from Orchestrator on startup:

- `GET /tools/list` — Discover available tools (filtered by agent's policy)
- `POST /tools/call` — Execute a tool (policy-checked by Orchestrator)

## Slash Commands (Telegram)

Telegram messages starting with `/` are intercepted by the Orchestrator before reaching the LLM. They execute instantly with zero token cost.

See [command-list.md](../command-list.md) for the full command reference.

**Key commands:** `/status`, `/status summary`, `/kill`, `/resume`, `/cron`, `/security`, `/logs`, `/delete`, `/diagnose`, `/help`

The `/diagnose` command runs 22 automated health checks (MCP health, Ollama connectivity, disk space, error baselines, cron schedules, etc.) and returns a categorized report with severity levels and actionable recommendations.

**Source:** `Orchestrator/src/core/slash-commands.ts`

## Halt Manager (Kill Switch)

The Orchestrator includes a persistent kill switch that can halt agents, Telegram polling, and Inngest jobs independently.

- **Persistent state:** Halt state is saved to `~/.annabelle/data/halt.json` — survives Orchestrator restarts
- **Target-specific:** Can halt `thinker`, `telegram`, or `inngest` independently, or `all` at once
- **Controlled via:** `/kill` and `/resume` Telegram commands, or HTTP REST API

**Source:** `Orchestrator/src/core/halt-manager.ts`

## Key Features

### Job Management (Inngest)

The Orchestrator includes a job management system powered by [Inngest](https://www.inngest.com/):

- **Cron Jobs** - Schedule recurring tasks with validated cron expressions (`0 9 * * *` = daily at 9am)
- **Timezone Support** - IANA timezone support (e.g., `Europe/Warsaw`, `America/New_York`)
- **One-Time Scheduled Jobs** - Schedule a task for a specific future time
- **Background Tasks** - Queue tasks for immediate async execution
- **Workflows** - Multi-step workflows with step dependencies
- **Automatic Retries** - 3 retries with exponential backoff
- **Validation** - Cron expressions and timezones are validated at creation time using [croner](https://github.com/nicknisi/croner)
- **Dashboard** - Real-time monitoring at http://localhost:8288

**How cron jobs work:** A `cronJobPollerFunction` runs every minute via Inngest. It loads all enabled cron jobs from storage, evaluates each cron expression against the current time (respecting timezones), and executes those that are due. The `lastRunAt` timestamp prevents double execution within the same minute.

### Real-Time Telegram Messages (GramJS)

The system supports real-time Telegram message handling:

1. **GramJS Event Handler** - Telegram MCP captures incoming messages instantly via MTProto
2. **Message Queue** - Messages stored in memory (up to 1000)
3. **Orchestrator Polling** - Inngest job polls every 10 seconds
4. **Memory Logging** - New messages automatically logged to Memory MCP

```
Telegram Message → GramJS Event Handler → Message Queue → Orchestrator Poll → Memory MCP
     (instant)          (instant)           (buffered)      (10 seconds)      (stored)
```

---

## Available Tools

### Core Tools (4 tools)

#### get_status

Get system status including available MCP servers and health info.

```
No parameters required.
```

#### send_telegram

Send a message via Telegram.

```
Parameters:
- message (required): The message to send
- chat_id (optional): Specific chat to send to
```

#### get_credential

Retrieve a credential from 1Password.

```
Parameters:
- item_name (required): Name of the 1Password item
- vault (optional): Vault to search in
```

#### execute_task

Execute a task with automatic tool selection.

```
Parameters:
- task (required): Description of what to do
- context (optional): Additional context
```

**Note:** Currently uses keyword-based task parsing. LLM-based parsing planned for future enhancement.

### Telegram Real-Time Tools (5 tools)

#### get_new_telegram_messages

Get new messages received in real-time since last check.

```
Parameters:
- peek (optional): If true, return without clearing queue
```

#### subscribe_telegram_chat

Subscribe to real-time messages from a specific chat.

```
Parameters:
- chat_id (required): Chat ID to subscribe to
```

#### unsubscribe_telegram_chat

Unsubscribe from a specific chat.

```
Parameters:
- chat_id (required): Chat ID to unsubscribe from
```

#### list_telegram_subscriptions

List all chat subscriptions for real-time messages.

```
No parameters required.
```

#### clear_telegram_subscriptions

Clear all subscriptions (receive messages from all chats).

```
No parameters required.
```

### Job Management Tools (5 tools)

#### create_job

Schedule a cron job or one-time scheduled task. Cron expressions and timezones are validated at creation time.

```
Parameters:
- name (required): Job name
- type (required): "cron" or "scheduled"
- cronExpression (for cron): Validated cron expression (e.g., "0 9 * * *", "*/5 * * * *")
- timezone (optional): IANA timezone, validated (default: "UTC", e.g., "Europe/Warsaw")
- scheduledAt (for scheduled): ISO timestamp (must be in the future)
- action (required): Tool call or workflow to execute
- enabled (optional): Whether the job is active (default: true)
```

#### queue_task

Queue a background task for immediate async execution.

```
Parameters:
- name (required): Task name
- action (required): Tool call to execute
```

#### list_jobs

List all scheduled jobs.

```
Parameters:
- enabled (optional): Filter by enabled status
```

#### get_job_status

Get status of a job or task.

```
Parameters:
- jobId or taskId (required): ID to check
```

#### delete_job

Delete a scheduled job.

```
Parameters:
- jobId (required): Job ID to delete
```

### Memory Tools (11 tools)

All memory tools route through to the Memorizer MCP with security scanning:

- `store_fact` - Store a fact about the user
- `list_facts` - List stored facts
- `delete_fact` - Delete a fact by ID
- `store_conversation` - Log a conversation
- `search_conversations` - Search conversation history
- `get_profile` - Get user profile
- `update_profile` - Update profile fields
- `retrieve_memories` - Search facts and conversations
- `get_memory_stats` - Get memory statistics
- `export_memory` - Export memory to files
- `import_memory` - Import memory from files

**Fact Categories:** preference, background, pattern, project, contact, decision

### File Operations Tools (13 tools)

All file operation tools route through to the Filer MCP with security scanning:

#### File Manipulation (8 tools)
- `create_file` - Create a new file with content
- `read_file` - Read file contents
- `list_files` - List files in directory
- `update_file` - Update existing file
- `delete_file` - Delete a file
- `move_file` - Move/rename a file
- `copy_file` - Copy a file
- `search_files` - Search files by pattern

#### Grant Management (3 tools)
- `check_grant` - Check file access permissions
- `request_grant` - Request file access
- `list_grants` - List all file grants

#### Workspace Info (2 tools)
- `get_workspace_info` - Get workspace details
- `get_audit_log` - Get file operation audit log

**Security Features:**
- File content security scanning before create/update
- Permission-based access control with grant system
- Workspace isolation (relative paths only)
- 50MB max file size limit

### Searcher Tools (2 tools)

All searcher tools route through to the Searcher MCP (Brave Search) via HTTP:

- `web_search` - Search the web using Brave Search
- `news_search` - Search news using Brave Search

### Gmail Tools (18 tools)

All Gmail tools route through to the Gmail MCP via HTTP:

#### Messages (8 tools)
- `list_emails` - List emails with optional filters
- `get_email` - Get a specific email by ID
- `send_email` - Send a new email
- `reply_email` - Reply to an existing email
- `delete_email` - Delete an email
- `mark_read` - Mark email as read/unread
- `modify_labels` - Add/remove labels on an email
- `get_new_emails` - Get new emails since last check (polling)

#### Drafts (5 tools)
- `list_drafts` - List email drafts
- `create_draft` - Create a new draft
- `update_draft` - Update an existing draft
- `send_draft` - Send a draft
- `delete_draft` - Delete a draft

#### Labels (3 tools)
- `list_labels` - List all Gmail labels
- `create_label` - Create a new label
- `delete_label` - Delete a label

#### Attachments (2 tools)
- `list_attachments` - List attachments on an email
- `get_attachment` - Download a specific attachment

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| TRANSPORT | stdio | Transport mode: "stdio" or "http" |
| PORT | 8010 | HTTP port (when TRANSPORT=http) |
| MCP_CONNECTION_MODE | stdio | How to connect to downstream MCPs: "stdio" (spawn) or "http" (legacy) |
| LOG_LEVEL | info | Log level: debug, info, warn, error |
| CHANNEL_POLLING_ENABLED | false | Enable Orchestrator-side Telegram polling |
| CHANNEL_POLL_INTERVAL_MS | 10000 | Polling interval in milliseconds |
| THINKER_URL | `http://localhost:8006` | Single-agent Thinker URL (fallback when no agents config) |
| AGENTS_CONFIG_PATH | _(none)_ | Path to agents JSON config file (enables multi-agent mode) |

> **Note:** Guardian security scanning is configured in `Orchestrator/src/config/guardian.ts` — see [Security — Guardian Pass-Through](#security--guardian-pass-through) below.

**Legacy HTTP mode variables** (only used when `MCP_CONNECTION_MODE=http`):

| Variable | Default | Description |
|----------|---------|-------------|
| GUARDIAN_MCP_URL | `http://localhost:8003` | Guardian MCP URL |
| TELEGRAM_MCP_URL | `http://localhost:8002` | Telegram MCP URL |
| ONEPASSWORD_MCP_URL | `http://localhost:8001` | 1Password MCP URL |
| MEMORY_MCP_URL | `http://localhost:8005` | Memory MCP URL |
| FILER_MCP_URL | `http://localhost:8004` | Filer MCP URL |
| SEARCHER_MCP_URL | `http://localhost:8007` | Searcher MCP URL |
| GMAIL_MCP_URL | `http://localhost:8008` | Gmail MCP URL |

## Docker

### Build and run

```bash
docker build -t annabelle-orchestrator .
docker run -p 8010:8010 annabelle-orchestrator
```

### Docker Compose

```bash
docker-compose up
```

## Development

```bash
# Type checking
npm run typecheck

# Development with watch mode
npm run dev

# Build for production
npm run build
```

## Security — Guardian Pass-Through

Guardian MCP provides transparent security scanning for tool calls flowing through the Orchestrator. It uses a **decorator pattern** — `GuardedMCPClient` wraps downstream MCP clients and intercepts `callTool()` to scan inputs and/or outputs before they pass through.

**Guardian is disabled by default.** To enable it, edit the config file.

### Configuration

**File:** `Orchestrator/src/config/guardian.ts` (symlinked at repo root as `guardian-config.ts`)

```typescript
export const guardianConfig = {
  enabled: false,               // Set to true to enable scanning
  failMode: 'closed' as const,  // 'closed' = block when Guardian unavailable

  input: {                      // Scan tool arguments BEFORE reaching the MCP
    telegram: true,
    onepassword: true,
    filer: true,
    gmail: true,
    memory: true,
    searcher: false,
  },

  output: {                     // Scan tool results BEFORE returning to caller
    onepassword: true,
    filer: true,
    gmail: true,
    telegram: false,
    memory: false,
    searcher: false,
  },
};
```

### Enabling Guardian

1. Set `enabled: true` in `Orchestrator/src/config/guardian.ts`
2. Ensure Ollama is running with the Guardian model loaded (`ollama run guardian`)
3. Restart the Orchestrator

### Disabling Guardian

**Disable all scanning globally:**

```typescript
// In Orchestrator/src/config/guardian.ts
enabled: false,  // All MCPs pass through without scanning
```

**Disable scanning for a specific MCP** (while keeping Guardian active for others):

```typescript
input: {
  telegram: false,  // Stop scanning Telegram inputs
  // ...other MCPs unchanged
},
```

### Fail Mode

Controls what happens when Guardian MCP itself is unavailable (e.g., Ollama not running):

- `'closed'` (default) — block all requests to guarded MCPs (secure, may cause downtime)
- `'open'` — allow requests through without scanning (keeps things running, less secure)

### How It Works

```text
Caller → Orchestrator → [GuardedMCPClient] → Guardian scan → Downstream MCP
                                ↓ (if blocked)
                         SecurityError returned
```

- Input scanning: tool arguments are scanned before reaching the downstream MCP
- Output scanning: tool results are scanned before returning to the caller
- Blocked requests return `{ success: false, blocked: true, error: "..." }`
- All scans are logged in Guardian's audit log (`get_scan_log` tool)

### What Gets Scanned

| MCP | Input | Output | Rationale |
| --- | --- | --- | --- |
| Telegram | Yes | No | Catch injection in outgoing messages |
| 1Password | Yes | Yes | Protect credentials from leakage |
| Filer | Yes | Yes | Scan file content both ways |
| Gmail | Yes | Yes | Scan email content both ways |
| Memory | Yes | No | Protect stored facts from injection |
| Searcher | No | No | Search queries are low-risk |
| CodeExec | Yes | No | Code args are high-risk; output follows |

### Per-Agent Guardian Overrides

Each agent can override global scan flags. This allows stricter scanning for untrusted agents or relaxed scanning for trusted ones.

```typescript
// In Orchestrator/src/config/guardian.ts
agentOverrides: {
  'work-assistant': {
    input: { memory: false },    // Skip input scanning on memory for this agent
    output: { gmail: false },    // Skip output scanning on gmail
  },
  'code-reviewer': {
    output: { telegram: true },  // Enable output scanning on telegram (globally off)
  },
},
```

Use `getEffectiveScanFlags(agentId)` to resolve the merged flags for a specific agent. Unlisted MCPs inherit the global defaults.

## REST API

### Kill Switch

```http
POST /kill
Content-Type: application/json

{ "target": "all" | "thinker" | "telegram" | "inngest" }
```

```http
POST /resume
Content-Type: application/json

{ "target": "all" | "thinker" | "telegram" | "inngest" }
```

### Agent Resume

Resume an agent that was paused by cost controls:

```http
POST /agents/:agentId/resume
Content-Type: application/json

{ "resetWindow": true }
```

- `resetWindow: false` (default) — resume but keep token history (may re-trigger if still over cap)
- `resetWindow: true` — resume and clear all token history (fresh start)

Returns `{ "success": true, "message": "Agent \"annabelle\" resumed" }` on success.

## External MCP System

Third-party MCP servers (e.g. PostHog, Vercel) can be integrated without modifying the core codebase. They are declared in `external-mcps.json` in the project root and loaded alongside internal MCPs at startup.

- Config file: `external-mcps.json` — JSON map of `name → { command, args, env }`
- Loaded via `Shared/Discovery/external-loader.ts`
- Hot-reloaded via `ExternalMCPWatcher` — editing the config file applies changes without restart
- Never `required` — a failed external MCP does not block startup
- Not scanned by Guardian by default

See `.documentation/external-mcp.md` for the full integration guide.

## Future Enhancements

- **LLM-based task parsing** - Replace keyword matching in `execute_task` with intelligent LLM-based parsing for complex multi-step tasks
- **Custom Web UI** - Add web-based interface connecting via REST API
