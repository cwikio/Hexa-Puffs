# Annabelle - System Architecture Overview

## What is Annabelle?

Annabelle is a personal AI assistant built on MCP (Model Context Protocol) architecture with defense-in-depth security. It coordinates between AI models, specialized MCP servers, and external data sources to provide intelligent, secure, and personalized assistance.

**Design Principles:**

- Security at every layer (no direct AI access to credentials or external systems)
- Modular MCP architecture (each capability is a separate, replaceable service)
- Learning assistant (remembers preferences, builds understanding over time)
- Single-user focus (personal assistant, not multi-tenant platform)

---

Paste this to claude if you want to launch annabelle from there. it autostarts whenever claude is launched.
to ad mcps cmd shift g and then ~/Library/Application Support/Claude/claude_desktop_config.json

    "annabelle": {
      "command": "node",
      "args": [
        "/Users/tomasz/Coding/AI Assistants/MCPs/Orchestrator/dist/Orchestrator/src/index.js"
      ],
      "env": {
        "TRANSPORT": "stdio",
        "TELEGRAM_MCP_URL": "http://localhost:8002",
        "GUARDIAN_MCP_URL": "http://localhost:8003",
        "ONEPASSWORD_MCP_URL": "http://localhost:8001",
        "FILER_MCP_URL": "http://localhost:8004",
        "MEMORY_MCP_URL": "http://localhost:8005",
        "SECURITY_FAIL_MODE": "open",
        "SCAN_ALL_INPUTS": "false",
        "LOG_LEVEL": "info"
      }
    }

## Architecture Layers

### Phase 1: MCP-First Architecture (Current)

The current architecture uses **Orchestrator as an agent router and protocol bridge**:

- **Claude Desktop/Code** connects via MCP stdio protocol
- **Thinker agents** are spawned and managed by Orchestrator's AgentManager
- **Orchestrator** polls channels (Telegram), routes messages to the correct agent, enforces per-agent tool policies
- **Downstream MCPs** are spawned by Orchestrator via stdio (no separate HTTP ports)

```mermaid
flowchart TB
    subgraph UI["User Interface Layer"]
        Claude["Claude Desktop / Claude Code"]
    end

    subgraph Orchestrator["Orchestrator MCP Server (:8010)"]
        direction TB
        Tools["65+ Tools (passthrough)<br/>send_message, store_fact, send_email, etc."]
        Security["Security Coordinator<br/>(Guardian integration)"]
        HTTPAPI["HTTP REST API<br/>/tools/list, /tools/call"]
        subgraph MultiAgent["Multi-Agent Layer"]
            ChannelPoller["ChannelPoller<br/>(polls Telegram)"]
            MsgRouter["MessageRouter<br/>(channel bindings)"]
            AgentMgr["AgentManager<br/>(spawns + monitors)"]
        end
        subgraph Jobs["Inngest Job System"]
            Cron["Cron Jobs"]
            Background["Background Tasks"]
        end
    end

    subgraph Agents["Thinker Agent Instances (spawned by Orchestrator)"]
        Agent1["Thinker :8006<br/>(default agent)"]
        Agent2["Thinker :8016<br/>(work agent)"]
        AgentN["Thinker :801N<br/>(...)"]
    end

    subgraph MCPs["Downstream MCP Servers (spawned via stdio)"]
        Guardian["Guardian MCP<br/>(security scanning)"]
        OnePass["1Password MCP<br/>(credentials)"]
        Telegram["Telegram MCP<br/>(messaging)"]
        Memory["Memory MCP<br/>(facts, conversations)"]
        Filer["Filer MCP<br/>(file operations)"]
    end

    subgraph HTTPMCPs["HTTP MCP Services (independent)"]
        Searcher["Searcher MCP<br/>:8007<br/>(Brave Search)"]
        Gmail["Gmail MCP<br/>:8008<br/>(email)"]
    end

    subgraph TelegramInternals["Telegram MCP Internals"]
        GramJS["GramJS Client<br/>(MTProto)"]
        EventHandler["NewMessage<br/>Event Handler"]
        Queue["Message Queue<br/>(max 1000)"]
    end

    subgraph External["External Services"]
        TelegramAPI["Telegram Servers"]
        InngestDev["Inngest Dev Server<br/>:8288"]
        LLM["LLM Provider<br/>(Groq / LM Studio / Ollama)"]
    end

    Claude -->|"MCP Protocol (stdio)"| Orchestrator
    ChannelPoller -->|"polls via ToolRouter"| Telegram
    MsgRouter -->|"routes messages"| AgentMgr
    AgentMgr -->|"HTTP POST /process-message"| Agents
    Agents -->|"HTTP REST API"| HTTPAPI
    Agents -->|"API calls"| LLM
    Orchestrator -->|stdio| Guardian
    Orchestrator -->|stdio| OnePass
    Orchestrator -->|stdio| Telegram
    Orchestrator -->|stdio| Memory
    Orchestrator -->|stdio| Filer
    Orchestrator -->|HTTP| Searcher
    Orchestrator -->|HTTP| Gmail
    Jobs -->|Events| InngestDev

    Telegram --> GramJS
    GramJS --> EventHandler
    EventHandler --> Queue
    GramJS <-->|MTProto| TelegramAPI
```

**ASCII Fallback:**

```
┌─────────────────────────────────────────────────────────────────┐
│                      USER INTERFACE LAYER                        │
│                                                                  │
│  ┌─────────────────────────┐                                    │
│  │  Claude Desktop/Code    │                                    │
│  │  (MCP client)           │                                    │
│  └───────────┬─────────────┘                                    │
│              │ stdio                                            │
└──────────────┼──────────────────────────────────────────────────┘
               ↓
┌─────────────────────────────────────────────────────────────────┐
│                   ORCHESTRATOR MCP SERVER (:8010)                │
│                                                                  │
│  HTTP REST API: /health, /tools/list, /tools/call               │
│  MCP stdio: Standard MCP protocol for Claude Desktop            │
│                                                                  │
│  65+ Tools (passthrough): send_message, store_fact, create_file │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Multi-Agent Layer                                        │   │
│  │  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐  │   │
│  │  │ ChannelPoller │ │ MessageRouter │ │ AgentManager  │  │   │
│  │  │ (polls TG)    │ │ (bindings)    │ │ (spawn/monitor│  │   │
│  │  └───────────────┘ └───────────────┘ └───────┬───────┘  │   │
│  └──────────────────────────────────────────────┼───────────┘   │
│                                                  ↓               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  THINKER AGENTS (spawned by AgentManager)                 │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐      │   │
│  │  │  Default     │ │  Work Agent  │ │  Agent N     │      │   │
│  │  │  (:8006)     │ │  (:8016)     │ │  (:801N)     │      │   │
│  │  └──────────────┘ └──────────────┘ └──────────────┘      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Inngest Job System                     │   │
│  │  ┌─────────────┐ ┌─────────────┐                         │   │
│  │  │  Cron Jobs  │ │ Background  │                         │   │
│  │  │             │ │   Tasks     │                         │   │
│  │  └─────────────┘ └─────────────┘                         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Security Coordinator (Guardian integration)                     │
└──────────────┬──────────────────────────────────┬───────────────┘
               │ stdio (spawns child processes)   │ HTTP
               ↓                                  ↓
┌──────────────────────────────────┐ ┌────────────────────────────┐
│  STDIO MCP SERVERS (spawned)     │ │  HTTP MCP SERVICES         │
│  ┌──────────┐ ┌──────────┐      │ │  ┌──────────┐              │
│  │ Guardian │ │ 1Password│      │ │  │ Searcher │              │
│  │   MCP    │ │   MCP    │      │ │  │ (:8007)  │              │
│  │ (stdio)  │ │ (stdio)  │      │ │  └──────────┘              │
│  └──────────┘ └──────────┘      │ │  ┌──────────┐              │
│  ┌──────────┐ ┌──────────┐      │ │  │  Gmail   │              │
│  │ Telegram │ │  Memory  │      │ │  │ (:8008)  │              │
│  │   MCP    │ │   MCP    │      │ │  └──────────┘              │
│  │ (stdio)  │ │ (stdio)  │      │ │                            │
│  └────┬─────┘ └──────────┘      │ └────────────────────────────┘
│  ┌──────────┐       │           │
│  │ File Ops │       │ GramJS    │
│  │   MCP    │       ↓           │
│  │ (stdio)  │ ┌──────────────┐  │
│  └──────────┘ │  Telegram    │  │
│               │  Servers     │  │
│               └──────────────┘  │
└──────────────────────────────────┘
```

### Phase 2: Custom UI (Future)

```
┌────────────────────────────────────────────────────────────────┐
│  Claude Desktop / LM Studio    OR       Custom Web UI           │
│       │                                    │                    │
│       │ MCP                                │ REST API           │
│       ↓                                    ↓                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              ORCHESTRATOR SERVICE                        │   │
│  │                                                          │   │
│  │   ┌────────────────────────────────────────────────┐    │   │
│  │   │              CORE LOGIC (shared)                │    │   │
│  │   └────────────────────────────────────────────────┘    │   │
│  │         ↑                           ↑                    │   │
│  │   ┌─────┴─────┐              ┌──────┴─────┐             │   │
│  │   │MCP Server │              │ REST API   │             │   │
│  │   └───────────┘              └────────────┘             │   │
│  │                                    │                     │   │
│  │                    ┌───────────────┴────────────────┐   │   │
│  │                    ↓                                ↓   │   │
│  │              Claude API                    LM Studio    │   │
│  │           (cloud, paid)              (local, free)      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ↓                                  │
│                    Downstream MCP Servers                       │
└────────────────────────────────────────────────────────────────┘
```

---

## AI Model Flexibility

The architecture supports **multiple AI backends** interchangeably:

### Phase 1: MCP Client Applications

| Application        | AI Model               | Connection      | Notes                                  |
| ------------------ | ---------------------- | --------------- | -------------------------------------- |
| **Claude Desktop** | Claude (cloud)         | MCP stdio       | Best tool use, paid                    |
| **Claude Code**    | Claude (cloud)         | MCP stdio       | Terminal-based                         |
| **Thinker agents** | Groq/LM Studio/Ollama  | Spawned by Orch | Per-agent LLM config, passive runtime  |
| **LM Studio**      | Local models           | MCP stdio       | Free, private, variable quality        |

All can connect to the Orchestrator and use your tools.

### Thinker LLM Configuration

Thinker supports multiple LLM providers via environment variables:

```bash
# Provider selection
THINKER_LLM_PROVIDER=groq  # groq | lmstudio | ollama

# Groq (cloud, fast, default)
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile

# LM Studio (local)
LMSTUDIO_BASE_URL=http://localhost:1234/v1

# Ollama (local)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

### Phase 2: REST API - Model Selection

When you add custom UI, the orchestrator calls AI APIs directly:

```yaml
ai_models:
  # Cloud option (better quality, paid)
  claude:
    provider: anthropic
    model: claude-sonnet-4-20250514
    endpoint: https://api.anthropic.com/v1/messages
    api_key: ${ANTHROPIC_API_KEY}

  # Local option (free, private)
  lm_studio:
    provider: openai_compatible
    model: your-local-model
    endpoint: http://localhost:1234/v1/chat/completions
    api_key: not-needed

  # Configuration
  default: lm_studio # or: claude
  fallback: claude # if primary fails
```

### Model-Agnostic Design

The orchestrator's core logic works with ANY model:

- Tools are exposed via standard MCP protocol
- REST API uses OpenAI-compatible format (works with Claude, LM Studio, Ollama, etc.)
- No model-specific code in core logic

---

## Component Overview

### Orchestrator (MCP Server)

**Specification:** `Orchestrator/ORCHESTRATION_LAYER_SPEC.md`

The orchestrator is itself an **MCP server** that Claude Desktop/Code connects to. It exposes high-level tools, manages multiple Thinker agent instances, and internally coordinates all other MCP servers.

**Key Responsibilities:**

- **Agent routing** - Spawns Thinker instances via AgentManager, routes incoming messages to the correct agent via MessageRouter
- **Channel polling** - Polls Telegram for new messages via ChannelPoller (replaces Thinker's old direct polling)
- **Tool policy enforcement** - Per-agent `allowedTools`/`deniedTools` glob patterns filter which tools each agent can use
- **Per-agent Guardian overrides** - Agent-specific input/output scan flags merged on top of global defaults
- Expose passthrough tools to Claude (original MCP tool names like `send_message`, `store_fact`, `create_file`)
- Auto-discover tools from downstream MCPs via ToolRouter
- Security enforcement via Guardian MCP
- Session management (scoped by agentId)

### Memory MCP

**Specification:** `Memory/MEMORY_MCP_SPEC.md`

Persistent learning and personalization. Stores facts learned from conversations, maintains user profile, enables memory transparency (user can see and edit what AI knows).

**Key Responsibilities:**

- Fact storage and retrieval
- Conversation logging
- User profile management (per agent)
- Memory transparency (export to viewable files)
- Automatic fact extraction from conversations
- Periodic synthesis of learnings

**Phase 1 Scope:** Simple key-value and text storage. No vector database or semantic search initially.

### File Ops MCP

**Specification:** `FileOps/FILE_OPS_MCP_SPEC.md`

File system operations and workspace management. Creates files AI generates, manages access grants to user's existing files, handles workspace organization.

**Key Responsibilities:**

- Create/read/update/delete files in AI workspace
- Access control via grants (user approves folder access)
- Workspace organization
- Temporary file cleanup
- Audit logging of all file operations

### Security MCP (Guardian)

**Status:** ✅ Implemented

Prompt injection detection, jailbreak prevention, PII leakage scanning using Granite Guardian model.

### 1Password MCP

**Status:** ✅ Implemented

Secure credential retrieval. AI never sees raw credentials - only gets tokens/results.

### Telegram MCP

**Status:** ✅ Implemented

Send notifications and receive commands via Telegram. Uses **GramJS** (MTProto protocol) for user account access (not bot API).

**Key Features:**

- Full user account access (read any message, not just bot mentions)
- Real-time message capture via event handlers
- In-memory message queue (up to 1000 messages)
- Chat subscription filtering

### Searcher MCP

**Status:** ✅ Implemented

Web search via Brave Search API. Runs as an independent HTTP service on port 8007.

**Key Features:**

- `web_search` - General web search
- `news_search` - News-specific search
- HTTP transport (not spawned by Orchestrator)

### Gmail MCP

**Status:** ✅ Implemented

Email management via Gmail API with OAuth2 authentication. Runs as an independent HTTP service on port 8008.

**Key Features:**

- 18 tools covering messages, drafts, labels, and attachments
- OAuth2 authentication (credentials stored at `~/.annabelle/gmail/`)
- Optional background email polling with configurable interval
- Optional Telegram notifications for new emails
- HTTP transport (not spawned by Orchestrator)

### Thinker (Agent Runtime)

**Status:** ✅ Implemented
**Specification:** `Thinker/ARCHITECTURE.md`

Passive AI reasoning engine that receives messages from Orchestrator via HTTP and processes them using LLM providers (Groq, LM Studio, Ollama). Orchestrator spawns one Thinker process per agent definition.

**Key Features:**

- **Passive runtime** - Receives messages via `POST /process-message` from Orchestrator, returns responses (does not poll or send directly)
- **LLM abstraction** - Supports Groq (cloud), LM Studio (local), Ollama (local), configurable per agent
- **ReAct agent loop** - Multi-step reasoning with tool use via Vercel AI SDK (`maxSteps: 2`)
- **Config-driven personality** - System prompt loaded from file path provided by Orchestrator at spawn
- **Context management** - Loads persona and facts from Memory MCP via Orchestrator's tool API
- **Per-agent tool filtering** - Discovers only tools allowed by agent's policy (via `agentId` query param)
- **LLM cost controls** - Anomaly-based spike detection with sliding-window algorithm; pauses agent and sends Telegram alert on abnormal token consumption

**Architecture:**

```
Orchestrator (:8010)
     │
     ├── spawns ──→ Thinker :8006 (default agent)
     ├── spawns ──→ Thinker :8016 (work agent)
     └── spawns ──→ Thinker :801N (...)
                        │
                        ├──HTTP──→ Orchestrator /tools/call (all tool access)
                        └──→ LLM Provider (Groq/LM Studio/Ollama)
```

**Default Port:** 8006 (each additional agent gets its own port)

### Inngest Job System

**Status:** ✅ Implemented (in Orchestrator)

Job management for scheduled and background tasks.

**Capabilities:**

- Recurring cron jobs with validated cron expressions (e.g., `0 9 * * *` = daily at 9am)
- IANA timezone support (e.g., `Europe/Warsaw`, `America/New_York`)
- One-time scheduled jobs at a specific future timestamp
- Background task queuing for immediate async execution
- Multi-step workflows with step dependencies
- Automatic retries (3x with exponential backoff)
- Real-time dashboard at `:8288`

**How cron execution works:**

A `cronJobPollerFunction` runs every minute via Inngest. It loads all enabled cron jobs, evaluates each expression against the current time (respecting timezones) using the [croner](https://github.com/nicknisi/croner) library, and executes those that are due. The `lastRunAt` timestamp prevents double execution.

**Documentation:** `Orchestrator/JOBS_README.md`

---

## Data Flow Patterns

### Pattern 1: User Request Flow

```
User sends message
       ↓
Orchestrator receives request
       ↓
Security MCP scans input ──→ [BLOCK if malicious]
       ↓
Memory MCP retrieves relevant context
       ↓
Orchestrator constructs enhanced prompt
       ↓
AI Model generates response (may include tool calls)
       ↓
[If tool calls] Execute via MCP servers
       ↓
[If sensitive tool] Security MCP scans output ──→ [BLOCK if PII leak]
       ↓
Memory MCP stores conversation + extracts facts
       ↓
Response returned to user
```

### Pattern 2: Scheduled Task Flow (Inngest)

```mermaid
sequenceDiagram
    participant Inngest as Inngest Dev Server
    participant Orchestrator
    participant Tool as Tool Handler
    participant Telegram as Telegram MCP
    participant Memory as Memory MCP

    Inngest->>Orchestrator: Cron trigger fires
    Orchestrator->>Orchestrator: Load job definition
    Orchestrator->>Tool: Execute action
    Tool-->>Orchestrator: Result
    alt On Failure
        Orchestrator->>Telegram: Send error notification
        Orchestrator->>Memory: Log error fact
    end
    Orchestrator-->>Inngest: Execution complete
```

**ASCII Fallback:**

```
Cron trigger fires (Inngest)
       ↓
Orchestrator loads job definition
       ↓
Execute tool calls via handler
       ↓
[If failure] Telegram notification + Memory logging
       ↓
Execution complete
```

### Pattern 3: Real-Time Telegram Message Flow (via Orchestrator)

```mermaid
sequenceDiagram
    participant User as Telegram User
    participant TG as Telegram Servers
    participant GramJS as GramJS Client (Telegram MCP)
    participant Orch as Orchestrator
    participant Router as MessageRouter
    participant Thinker as Thinker Agent

    User->>TG: Sends message
    TG->>GramJS: MTProto update (instant)
    GramJS->>GramJS: Queue message

    loop Every 10 seconds (ChannelPoller)
        Orch->>GramJS: get_messages (via ToolRouter)
        GramJS-->>Orch: Recent messages
        Orch->>Orch: Filter (skip own, old, duplicates, max 3/cycle)
        Orch->>Router: resolveAgents(channel, chatId)
        Router-->>Orch: agentId
        Orch->>Thinker: POST /process-message
        Thinker->>Thinker: LLM generates response (Groq, maxSteps: 2)
        opt Tool calls needed
            Thinker->>Orch: GET /tools/list, POST /tools/call
            Orch->>Orch: Enforce tool policy for agentId
            Orch-->>Thinker: Tool results
        end
        Thinker-->>Orch: Response
        Orch->>GramJS: send_message (via ToolRouter)
    end
```

**ASCII Fallback:**

```
Telegram User sends message
       ↓
Telegram Servers (MTProto)
       ↓ (instant)
GramJS NewMessage Event Handler (Telegram MCP, spawned via stdio)
       ↓
Orchestrator ChannelPoller polls get_messages (every 10s via ToolRouter)
       ↓
Filter: skip bot's own messages, old messages (>2min), duplicates, max 3/cycle
       ↓
MessageRouter resolves agentId from channel bindings
       ↓
POST /process-message to correct Thinker instance
       ↓
LLM processes message (Groq, maxSteps: 2)
       ↓ (if tools needed)
Thinker calls Orchestrator /tools/call (policy-filtered per agent)
       ↓
Orchestrator sends response via send_message (ToolRouter → Telegram MCP)
```

**Chat Discovery:** Orchestrator's ChannelPoller auto-discovers private chats via `list_chats`, excluding bot's own Saved Messages. Subscriptions refresh every 5 minutes.

**Note:** Inngest also polls Telegram (every 60s) to store messages in Memory MCP for history, but the ChannelPoller handles all real-time responses.

### Pattern 4: Webhook Event Flow (Future)

```
External event arrives (Gmail, Calendar, GitHub)
       ↓
Validate webhook signature
       ↓
Security MCP scans payload content
       ↓
Determine if significant
       ↓
[If significant] Construct prompt for AI analysis
       ↓
Execute AI recommendations
       ↓
Acknowledge webhook
```

---

## Agent Architecture

### Multi-Agent System (Implemented)

Orchestrator spawns and manages multiple Thinker instances, each with its own LLM config, system prompt, tool permissions, and channel bindings.

**Agent Configuration** (`agents.json`):

```json
{
  "agents": [
    {
      "agentId": "annabelle",
      "port": 8006,
      "llmProvider": "groq",
      "model": "llama-3.3-70b-versatile",
      "systemPrompt": "You are Annabelle, a personal assistant...",
      "allowedTools": ["*"],
      "maxSteps": 5,
      "costControls": {
        "enabled": true,
        "hardCapTokensPerHour": 500000,
        "spikeMultiplier": 3.0,
        "notifyChatId": "12345"
      }
    },
    {
      "agentId": "work-assistant",
      "port": 8016,
      "llmProvider": "groq",
      "model": "llama-3.3-70b-versatile",
      "systemPrompt": "You are a professional work assistant...",
      "allowedTools": ["gmail_*", "filer_*", "web_search"],
      "deniedTools": ["telegram_*"],
      "maxSteps": 3
    }
  ],
  "bindings": [
    { "channel": "telegram", "chatId": "12345", "agentId": "work-assistant" },
    { "channel": "telegram", "chatId": "*", "agentId": "annabelle" }
  ]
}
```

**How It Works:**

1. **AgentManager** spawns one Thinker process per agent definition, passing env vars for port, LLM config, system prompt path, and agent ID
2. **ChannelPoller** polls Telegram for new messages via the ToolRouter
3. **MessageRouter** resolves which agent handles each message based on channel bindings (exact match → wildcard → default agent)
4. Orchestrator dispatches the message to the correct Thinker via `POST /process-message`
5. Thinker runs its ReAct loop, calling tools back through Orchestrator's `/tools/call` endpoint
6. Orchestrator enforces **tool policy** — each agent only sees tools matching its `allowedTools`/`deniedTools` globs
7. Orchestrator sends the response back to Telegram via the ToolRouter

**Single-Agent Fallback:** If no `agents.json` is configured, Orchestrator falls back to connecting to a single Thinker at `THINKER_URL` — identical to pre-multi-agent behavior.

**Key Components:**

- `AgentManager` — spawns processes, monitors health, auto-restarts crashed agents, tracks cost-pause state
- `ChannelPoller` — polls Telegram via ToolRouter, deduplicates messages
- `MessageRouter` — resolves `(channel, chatId)` → `agentId` via config-driven bindings
- `ToolRouter.isToolAllowed()` — glob-based allow/deny filtering per agent
- `getEffectiveScanFlags(agentId)` — per-agent Guardian scan overrides

---

## Security Model

### Defense in Depth

```
Layer 1: Input Validation
         └── Malformed request rejection, rate limiting

Layer 2: Security MCP Scanning
         └── Prompt injection, jailbreak, social engineering detection

Layer 3: Tool Authorization
         └── Agent can only use permitted MCPs

Layer 4: Output Scanning (Selective)
         └── PII/credential leak prevention on sensitive operations

Layer 5: MCP Isolation
         └── Each MCP has minimal permissions, no direct internet access

Layer 6: Credential Separation
         └── Secrets in 1Password, never in prompts or logs

Layer 7: LLM Cost Controls
         └── Anomaly-based spike detection, hard cap, auto-pause with Telegram alert
```

### What Gets Scanned

| Operation           | Input Scan         | Output Scan         |
| ------------------- | ------------------ | ------------------- |
| User message        | ✅ Always          | -                   |
| AI response         | -                  | ❌ Usually not      |
| 1Password tool call | -                  | ✅ Always           |
| Telegram send       | -                  | ✅ Always           |
| Email send          | -                  | ✅ Always           |
| File read           | ✅ Content scanned | -                   |
| File write          | -                  | ✅ If external path |

---

## Storage Strategy

### System Files (Hidden)

```
~/.annabelle/
├── config/
│   ├── orchestrator.yaml
│   ├── agents.yaml
│   └── mcp-servers.yaml
├── data/
│   ├── memory.db          ← SQLite database
│   └── grants.db          ← File access permissions
├── logs/
│   ├── orchestrator.log
│   ├── security.log
│   └── audit.log
└── memory-export/         ← Memory transparency files
    ├── profile.json
    ├── facts/
    └── conversations/
```

### User Workspace (Visible)

```
~/Documents/AI-Workspace/   ← User chooses location
├── Documents/
│   ├── reports/
│   └── notes/
├── Code/
│   ├── python/
│   └── scripts/
├── Research/
└── temp/                   ← Auto-cleaned after 7 days
```

### User's Existing Files (Granted Access)

```
~/Documents/Work/           ← User grants access
├── Projects/               ← AI can read/write (if granted)
└── Reports/                ← AI can read-only (if granted)
```

---

## Implementation Phases

### Phase 1: Foundation ✅ Complete

**Goal:** Working MCP-based system with Claude Desktop and autonomous AI agent

**Components:**

- ✅ Security MCP (Guardian) - Prompt injection detection
- ✅ 1Password MCP - Secure credential retrieval
- ✅ Telegram MCP - Messaging with real-time event handling
- ✅ Memory MCP - Fact storage, conversations, profiles
- ✅ Filer MCP - File operations with grants
- ✅ Orchestrator MCP - Central coordination with 65+ tools (protocol bridge)
- ✅ Searcher MCP - Web search via Brave Search (HTTP :8007)
- ✅ Gmail MCP - Email management with OAuth2 (HTTP :8008)
- ✅ Thinker - Autonomous AI agent with configurable LLM
- ✅ Inngest Job System - Cron jobs, background tasks, workflows

**How it works:**

- Orchestrator acts as an **agent router and protocol bridge**:
  - Accepts MCP stdio from Claude Desktop/Code
  - Spawns and manages Thinker agent instances via AgentManager
  - Polls Telegram via ChannelPoller, routes messages to agents via MessageRouter
  - Spawns downstream MCPs via stdio (Guardian, Telegram, 1Password, Memory, Filer)
  - Connects to independent HTTP MCP services (Searcher :8007, Gmail :8008)
- Thinker instances receive messages from Orchestrator, process via LLM, return responses
- Inngest handles scheduled and background tasks

**Key Files:**

- `launch-all.sh` - Launches Orchestrator (spawns MCPs) + Thinker + Inngest
- `Orchestrator/JOBS_README.md` - Job system documentation
- `Thinker/ARCHITECTURE.md` - Thinker design and configuration
- `Telegram/src/telegram/events.ts` - Real-time event handling

### Phase 2: Custom UI (Future)

**Goal:** Add custom web interface alongside Claude Desktop

**Add:**

- REST API interface to orchestrator
- Custom web chat UI
- Orchestrator calls Claude API directly
- Full prompt control

**Still works:**

- Claude Desktop via MCP (backward compatible)
- All existing functionality

### Phase 3: Enhanced Memory

**Goal:** Smarter memory and more MCPs

**Add:**

- Vector embeddings for semantic search
- Weekly memory synthesis
- More MCP servers (GSuite, GitHub, Calendar)
- Webhook processing

### Phase 4: Advanced Features

**Goal:** Power user capabilities

**Add:**

- ✅ Multi-agent support - Orchestrator spawns multiple Thinker instances with per-agent config, channel bindings, tool policies, and Guardian overrides
- Obsidian workspace integration
- ✅ Workflow engine (Inngest) - Complete
- ✅ Scheduled tasks (Inngest cron) - Complete
- ✅ Real-time Telegram messages - Complete (now via Orchestrator's ChannelPoller)

---

## Cross-Reference Index

| Topic                | Primary Document     | Related Sections                 |
| -------------------- | -------------------- | -------------------------------- |
| Request routing      | Orchestrator/SPEC.md | Section: Request Intake          |
| Security scanning    | Orchestrator/SPEC.md | Section: Security Integration    |
| MCP coordination     | Orchestrator/SPEC.md | Section: MCP Server Coordination |
| Task scheduling      | Orchestrator/SPEC.md | Section: Task Scheduling         |
| Webhooks             | Orchestrator/SPEC.md | Section: Webhook Handling        |
| Memory storage       | Memory/SPEC.md       | Section: Storage Architecture    |
| Fact extraction      | Memory/SPEC.md       | Section: Automatic Learning      |
| User profile         | Memory/SPEC.md       | Section: Profile Management      |
| Memory transparency  | Memory/SPEC.md       | Section: Memory Export           |
| File operations      | FileOps/SPEC.md      | Section: Core Operations         |
| Workspace management | FileOps/SPEC.md      | Section: Workspace               |
| Access grants        | FileOps/SPEC.md      | Section: Grants System           |

---

## Naming Conventions

### MCP Servers

- Format: `{capability}-mcp`
- Examples: `security-mcp`, `memory-mcp`, `telegram-mcp`
- **Ports (new architecture):**
  - Orchestrator HTTP: 8010
  - Thinker default agent: 8006 (additional agents get their own ports)
  - Searcher HTTP: 8007
  - Gmail HTTP: 8008
  - Inngest Dev Server: 8288
  - Downstream MCPs: spawned via stdio (no ports)
- **Legacy ports (individual HTTP mode):**
  - 8000-8005 range (backwards compatibility)

### Agents

- Format: lowercase, kebab-case
- Examples: `annabelle`, `work-assistant`, `code-reviewer`
- Configured in `agents.json` with per-agent port, LLM config, system prompt, tool policy

### Configuration Files

- Format: `{component}.yaml` or `{component}-config.yaml`
- Environment variables: `ANNABELLE_{COMPONENT}_{SETTING}`

### Database Tables

- Format: `snake_case`
- Examples: `facts`, `conversations`, `user_profiles`, `file_grants`

---

## Key Design Decisions

| Decision             | Choice                | Rationale                                                    |
| -------------------- | --------------------- | ------------------------------------------------------------ |
| MCP vs monolith      | MCP architecture      | Modularity, replaceability, security isolation               |
| Single vs multi-user | Single user           | Simpler, personal assistant focus                            |
| AI model             | **Model-agnostic**    | Works with Claude, LM Studio, Ollama, any OpenAI-compatible  |
| Default AI           | User choice           | Claude (quality) OR LM Studio (privacy/free)                 |
| Vector DB initially  | No                    | Simplicity first, add later if needed                        |
| Memory transparency  | Yes                   | User control over what AI knows                              |
| Obsidian integration | Deferred              | Nice-to-have, not core                                       |
| Multi-agent          | **Yes (implemented)** | Orchestrator spawns agents, routes messages, enforces policy |

---

## Next Steps

1. **Read** `Orchestrator/ORCHESTRATION_LAYER_SPEC.md` for orchestrator implementation
2. **Read** `Memory/MEMORY_MCP_SPEC.md` for memory system implementation
3. **Read** `FileOps/FILE_OPS_MCP_SPEC.md` for file operations implementation
4. **Implement** orchestrator first (coordinates everything else)
5. **Implement** Memory MCP (enables personalization)
6. **Implement** File Ops MCP (enables file creation)
