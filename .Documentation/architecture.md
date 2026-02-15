# System Architecture

> How the Annabelle system is structured, how its components communicate, and how data flows through the stack.

## Component Inventory

| Component | Type | Port | Purpose |
|-----------|------|------|---------|
| Orchestrator | Central hub | 8010 | MCP management, tool routing, message dispatch, HTTP API |
| Thinker | REST agent | 8006 | LLM reasoning, tool selection, conversation management |
| Guardian | Stdio MCP | - | Prompt injection scanning (Granite Guardian) |
| 1Password | Stdio MCP | - | Read-only vault access via `op` CLI |
| Filer | Stdio MCP | - | File operations with workspace isolation |
| Memorizer | Stdio MCP | - | Persistent memory (facts, conversations, profiles) |
| CodeExec | Stdio MCP | - | Sandboxed code execution (Python/Node/Bash) |
| Searcher | Stdio MCP | - | Web/news/image search via Brave API |
| Gmail | Stdio MCP | - | Email and Google Calendar via OAuth |
| Telegram | Stdio MCP | - | Telegram messaging via MTProto |
| Browser | Stdio MCP | - | Headless Chromium via Playwright |
| Inngest | Job scheduler | 8288 | Cron jobs, background tasks, scheduled skills |

## Process Model

All stdio MCPs are **child processes** spawned by the Orchestrator. They communicate via stdin/stdout using the MCP JSON-RPC protocol. The Orchestrator is the only process that talks to all MCPs. Non-Node MCPs can be spawned using the `command` field from their manifest (e.g. `.venv/bin/python`) instead of `node`.

Thinker is a **separate Node.js process** that exposes a REST API. The Orchestrator communicates with it via HTTP. Thinker never talks to MCPs directly — all tool calls go through the Orchestrator.

Inngest runs as a local dev server. The Orchestrator registers its functions with Inngest at startup.

## Data Flow: User Message

```
User (Telegram)
  │
  ▼
Orchestrator ─── ChannelManager polls Telegram MCP for new messages
  │
  ├── SlashCommandHandler: intercepts /status, /logs, /kill, etc.
  │
  ├── Guardian: scans input for prompt injection
  │     └── If blocked → drop message, log threat
  │
  ▼
AgentManager ─── routes message to Thinker (lazy-spawn if not running)
  │
  ▼
Thinker (processMessage)
  │
  ├── 1. Build context: load session, fetch profile + memories, inject playbooks
  ├── 2. Select tools: embedding similarity + regex matching → top N tools
  ├── 3. Call LLM (Groq/LM Studio/Ollama) with system prompt + tools + history
  ├── 4. If LLM wants tool call:
  │     └── POST /tools/call → Orchestrator → Guardian scan → MCP → response
  │     └── Loop back to step 3 with tool result (up to maxSteps)
  ├── 5. Save turn to session JSONL
  ├── 6. Schedule fact extraction (5 min idle timer)
  │
  ▼
Orchestrator ─── sends response back via Telegram MCP
```

## Tool Routing

**File:** `Orchestrator/src/routing/tool-router.ts`

Tools are **prefixed** with their MCP name using underscore separator:

| MCP Name | Original Tool | Exposed As |
|----------|--------------|------------|
| `memory` | `store_fact` | `memory_store_fact` |
| `filer` | `read_file` | `filer_read_file` |
| `codexec` | `execute_code` | `codexec_execute_code` |
| `gmail` | `send_email` | `gmail_send_email` |

The ToolRouter maintains a routing table: `exposedName → { mcpName, originalName, client }`. When a tool call arrives, it strips the prefix, finds the right MCP client, and forwards the call.

**Tool policy per agent:** Each agent definition in `agents.json` can specify `allowedTools` and `deniedTools` (glob patterns like `codexec_*`). The ToolRouter filters tools before sending them to Thinker.

**Custom Orchestrator tools** (not routed to MCPs):
- `get_status` — system status
- `system_health_check` — MCP health
- `get_tool_catalog` — lightweight tool discovery (names + descriptions, grouped by MCP)
- `queue_task` — background tasks
- `trigger_backfill` — embedding backfill
- `spawn_subagent` — create temporary sub-agent

## Auto-Discovery

**File:** `Shared/Discovery/scanner.ts`

At startup, the Orchestrator scans **sibling directories** for `package.json` files containing an `"annabelle"` field:

```json
{
  "annabelle": {
    "mcpName": "filer",
    "transport": "stdio",
    "sensitive": true
  }
}
```

The scanner builds a dynamic configuration map of all available MCPs. Optional fields:
- `role: "guardian"` — always initialized first
- `role: "channel"` — used for channel polling bindings
- `transport: "http"` + `httpPort` — for HTTP MCPs
- `sensitive: true` — affects audit logging
- `timeout` — override default MCP timeout

**Disable via env:** `${NAME}_MCP_ENABLED=false` (e.g., `FILER_MCP_ENABLED=false`)

## Channel System

**File:** `Orchestrator/src/channels/`

The ChannelManager polls channel MCPs (identified by `role: "channel"`) for new messages. Currently only Telegram is a channel MCP.

Polling flow:
1. ChannelManager calls `telegram_get_new_messages` at a configured interval
2. New messages are matched to agents via `bindings` in `agents.json`
3. Each message is dispatched to the bound agent's Thinker instance

Bindings example: `{ "channel": "telegram", "chatId": "*", "agentId": "annabelle" }` routes all Telegram messages to the Annabelle agent.

## Agent System

**File:** `Orchestrator/src/core/agent-manager.ts`

Agents are defined in `agents.json` and managed by AgentManager:

- **Lazy spawn:** Agents register at startup but only spawn on first message
- **Idle kill:** Running agents are stopped after configurable inactivity (default 5 min scan interval)
- **Health monitoring:** Auto-restart crashed agents (30s interval, max 5 restarts, 10s cooldown)
- **Subagents:** Dynamic temporary agents spawned for parallel tasks (max 5 per parent, auto-kill timer)

Agent states: `stopped → starting → running → stopping`

## Orchestrator HTTP API

**File:** `Orchestrator/src/index.ts`

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /health` | None | Basic health check |
| `GET /status` | Token | Full system status |
| `POST /message` | Token | Send message to agent |
| `GET /tools/list` | Token | List all available tools |
| `POST /tools/call` | Token | Execute a tool |
| `GET /agents` | Token | List agents with status |
| `POST /agents/:id/resume` | Token | Resume paused agent |

Auth via `X-Annabelle-Token` header (generated by `start-all.sh`, stored at `~/.annabelle/annabelle.token`).

## Key Files

| File | Purpose |
|------|---------|
| `Orchestrator/src/core/orchestrator.ts` | Core MCP lifecycle, health monitoring, startup |
| `Orchestrator/src/routing/tool-router.ts` | Tool naming, routing, policy filtering |
| `Orchestrator/src/core/agent-manager.ts` | Agent spawn/kill/health, subagents |
| `Orchestrator/src/channels/channel-manager.ts` | Telegram polling, message dispatch |
| `Orchestrator/src/commands/slash-commands.ts` | /status, /logs, /security, /cron, etc. |
| `Orchestrator/src/jobs/skill-scheduler.ts` | Inngest skill poller, tier routing, pre-flight checks |
| `Orchestrator/src/utils/skill-normalizer.ts` | Input normalization, graduated backoff |
| `Orchestrator/src/jobs/executor.ts` | Direct tier execution (executeWorkflow) |
| `Orchestrator/src/tools/tool-catalog.ts` | get_tool_catalog tool |
| `Orchestrator/src/server.ts` | MCP server interface (listTools, callTool) |
| `Shared/Discovery/scanner.ts` | Auto-discovery from package.json manifests |
| `Thinker/src/agent/loop.ts` | LLM reasoning loop, context building, tool execution |
| `agents.json` | Agent definitions, bindings, cost controls |
