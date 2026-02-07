# Annabelle Orchestrator MCP

The central orchestration layer for Annabelle AI Assistant. The Orchestrator acts as a **protocol bridge** that:

- Accepts MCP stdio connections from Claude Desktop/Code
- Accepts HTTP REST API calls from Thinker (autonomous AI agent)
- Spawns and manages downstream MCPs via stdio
- Connects to independent HTTP MCP services (Searcher, Gmail)

## Architecture

```
┌─────────────────────────┐    ┌─────────────────────────┐
│   Claude Desktop/Code   │    │        THINKER          │
│                         │    │        (:8006)          │
│   (MCP client)          │    │  (Autonomous AI Agent)  │
└───────────┬─────────────┘    └───────────┬─────────────┘
            │ stdio                        │ HTTP
            └──────────────┬───────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│              ORCHESTRATOR MCP (:8010)                    │
│                                                          │
│  HTTP REST API:                                          │
│  - GET  /health         Health check                     │
│  - GET  /tools/list     List all available tools         │
│  - POST /tools/call     Execute a tool                   │
│                                                          │
│  MCP stdio:                                              │
│  - Standard MCP protocol for Claude Desktop              │
│                                                          │
│  65+ Tools (passthrough from downstream MCPs):           │
│  - send_message, list_chats (Telegram)                   │
│  - store_fact, list_facts, get_profile (Memory)          │
│  - create_file, read_file, list_files (Filer)            │
│  - get_item, list_vaults (1Password)                     │
│  - scan_content (Guardian)                               │
│  - web_search, news_search (Searcher)                    │
│  - list_emails, send_email, reply_email (Gmail)          │
│  - get_status (built-in)                                 │
└──────────────┬──────────────────────────┬───────────────┘
               │ stdio (spawns children)  │ HTTP
               ↓                          ↓
┌──────────────────────────────┐ ┌────────────────────────┐
│  STDIO MCP SERVERS (spawned) │ │  HTTP MCP SERVICES     │
│  ┌────────┐ ┌────────┐      │ │  ┌──────────┐          │
│  │Guardian│ │Telegram│      │ │  │ Searcher │          │
│  │(stdio) │ │(stdio) │      │ │  │ (:8007)  │          │
│  └────────┘ └────────┘      │ │  └──────────┘          │
│  ┌────────┐ ┌────────┐      │ │  ┌──────────┐          │
│  │1Pass   │ │ Filer  │      │ │  │  Gmail   │          │
│  │(stdio) │ │(stdio) │      │ │  │ (:8008)  │          │
│  └────────┘ └────────┘      │ │  └──────────┘          │
│  ┌────────┐                  │ │                        │
│  │Memory  │                  │ │                        │
│  │(stdio) │                  │ │                        │
│  └────────┘                  │ │                        │
└──────────────────────────────┘ └────────────────────────┘
```

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

- Orchestrator (port 8010) - spawns stdio MCPs, connects to HTTP MCPs
- Searcher (port 8007) - web search (must be started separately)
- Gmail (port 8008) - email management (must be started separately)
- Thinker (port 8006) - autonomous AI agent
- Inngest Dev Server (port 8288) - job management dashboard

```bash
cd /Users/tomasz/Coding/AI\ Assistants/MCPs
./launch-all.sh
```

This script:

1. Starts Inngest Dev Server
2. Starts Orchestrator with `TRANSPORT=http PORT=8010 MCP_CONNECTION_MODE=stdio`
3. Orchestrator automatically spawns: Telegram, Memory, Filer, Guardian, 1Password MCPs
4. Orchestrator connects to HTTP services: Searcher (:8007), Gmail (:8008)
5. Starts Thinker connected to Orchestrator

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

## Thinker Integration

Thinker connects to Orchestrator via HTTP REST API:

```bash
# Thinker environment
ORCHESTRATOR_URL=http://localhost:8010
```

Thinker uses these endpoints:

- `GET /health` - Health check
- `GET /tools/list` - Discover all available tools
- `POST /tools/call` - Execute a tool with `{ name, arguments }`

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

| Variable            | Default | Description                                                           |
| ------------------- | ------- | --------------------------------------------------------------------- |
| TRANSPORT           | stdio   | Transport mode: "stdio" or "http"                                     |
| PORT                | 8010    | HTTP port (when TRANSPORT=http)                                       |
| MCP_CONNECTION_MODE | stdio   | How to connect to downstream MCPs: "stdio" (spawn) or "http" (legacy) |
| LOG_LEVEL           | info    | Log level: debug, info, warn, error                                   |

> **Note:** Guardian security scanning is no longer configured via environment variables. It is controlled by `Orchestrator/src/config/guardian.ts` — see [Security — Guardian Pass-Through](#security--guardian-pass-through) below.

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
docker run -p 8000:8000 annabelle-orchestrator
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

| MCP        | Input | Output | Rationale                            |
| ---------- | ----- | ------ | ------------------------------------ |
| Telegram   | Yes   | No     | Catch injection in outgoing messages |
| 1Password  | Yes   | Yes    | Protect credentials from leakage     |
| Filer      | Yes   | Yes    | Scan file content both ways          |
| Gmail      | Yes   | Yes    | Scan email content both ways         |
| Memory     | Yes   | No     | Protect stored facts from injection  |
| Searcher   | No    | No     | Search queries are low-risk          |

## Future Enhancements

- **LLM-based task parsing** - Replace keyword matching in `execute_task` with intelligent LLM-based parsing for complex multi-step tasks
- **Custom Web UI** - Add web-based interface connecting via REST API
