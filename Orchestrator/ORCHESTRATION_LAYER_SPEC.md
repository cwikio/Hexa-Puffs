# Orchestration Layer - Product Specification

**Parent Document:** `../SYSTEM_ARCHITECTURE.md`
**Related Specs:** `../Memory/MEMORY_MCP_SPEC.md`, `../FileOps/FILE_OPS_MCP_SPEC.md`

---

## Purpose & Vision

The Orchestration Layer coordinates all AI assistant capabilities - security scanning, memory, file operations, and external tools. It's designed as a **protocol bridge** that can be accessed via:

- **MCP stdio** - For Claude Desktop/Code (standard MCP protocol)
- **HTTP REST API** - For Thinker (autonomous AI agent) and future custom UIs

**Core Mission:** Provide unified, secure access to all assistant capabilities through multiple interfaces.

**Current Implementation:**

- Orchestrator runs on port 8010 with HTTP transport
- Spawns all downstream MCPs (Telegram, Memory, Filer, Guardian, 1Password) via stdio
- Exposes 45+ tools from all MCPs through unified API
- Thinker connects via HTTP to process Telegram messages autonomously

---

## Modular Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                      INTERFACE LAYER                             │
│                                                                  │
│  ┌──────────────────────┐      ┌──────────────────────┐         │
│  │     MCP SERVER       │      │    HTTP REST API     │         │
│  │     (stdio)          │      │    (:8010)           │         │
│  │                      │      │                      │         │
│  │  Claude Desktop/Code │      │  Thinker (:8006)     │         │
│  │  connects here       │      │  connects here       │         │
│  └──────────┬───────────┘      └──────────┬───────────┘         │
│             │                             │                      │
│             └──────────────┬──────────────┘                      │
│                            ↓                                     │
└────────────────────────────┼────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────┐
│                            ↓                                     │
│                   CORE ORCHESTRATION                             │
│                                                                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────────┐ │
│  │  Security   │ │   Memory    │ │    Tool     │ │  Session   │ │
│  │ Coordinator │ │  Manager    │ │   Router    │ │  Manager   │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └────────────┘ │
│                                                                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────┼────────────────────────────────────┐
│                            ↓                                     │
│              MCP CLIENT LAYER (spawned via stdio)                │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │ Guardian │ │ 1Password│ │ Telegram │ │  Memory  │           │
│  │   MCP    │ │   MCP    │ │   MCP    │ │   MCP    │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                        │
│  │ File Ops │ │  Calendar│ │  GitHub  │  ... (future)          │
│  │   MCP    │ │   MCP    │ │   MCP    │                        │
│  └──────────┘ └──────────┘ └──────────┘                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Thinker Integration

Thinker is an autonomous AI agent that connects to Orchestrator via HTTP REST API:

```text
Thinker (:8006)
    │
    │  HTTP REST API
    │  GET  /tools/list    → Discover 45+ tools
    │  POST /tools/call    → Execute tool { name, arguments }
    │  GET  /health        → Health check
    │
    ↓
Orchestrator (:8010)
    │
    │  stdio (spawns child processes)
    ↓
Downstream MCPs (Telegram, Memory, Filer, Guardian, 1Password)
```

**Key points:**

- Thinker polls Telegram messages and processes them with LLM (Groq/LM Studio/Ollama)
- Uses ReAct agent loop with tool calling via Vercel AI SDK
- Discovers tools dynamically from Orchestrator on startup
- All tool calls go through Orchestrator → routed to correct MCP

---

## Key Design Principle: Same Core, Multiple Interfaces

The **Core Orchestration** layer contains all the logic. The interfaces (MCP Server, REST API) are thin wrappers that translate requests to core functions.

```
                    ┌─────────────────┐
                    │   Core Logic    │
                    │                 │
                    │ • scan_input()  │
                    │ • get_memory()  │
                    │ • execute_tool()│
                    │ • store_convo() │
                    └────────┬────────┘
                             │
           ┌─────────────────┼─────────────────┐
           ↓                 ↓                 ↓
    ┌────────────┐    ┌────────────┐    ┌────────────┐
    │ MCP Tool:  │    │ REST API:  │    │ Future:    │
    │ ask_anna() │    │ POST /chat │    │ WebSocket  │
    └────────────┘    └────────────┘    └────────────┘
```

**Benefits:**
- Add new interfaces without changing core logic
- Test core logic independently
- Swap interfaces without breaking functionality

---

## Phase 1: MCP Server Interface

### How It Works with Claude Desktop

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLAUDE DESKTOP                               │
│                                                                  │
│  User: "Send my todo list to Telegram"                          │
│                                                                  │
│  Claude (thinking): I should use the execute_task tool           │
│                                                                  │
│  Claude calls: execute_task(task="Send my todo list...")        │
│                                                                  │
└─────────────────────────┬───────────────────────────────────────┘
                          │ MCP Protocol
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│                  ORCHESTRATOR MCP SERVER                         │
│                                                                  │
│  Receives tool call → Core processes → Returns result            │
│                                                                  │
│  Internally:                                                     │
│  1. Security scan (Guardian MCP)                                 │
│  2. Get memories (Memory MCP)                                    │
│  3. Execute tools (Telegram MCP, etc.)                           │
│  4. Store conversation (Memory MCP)                              │
│  5. Return result to Claude                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### MCP Tools Exposed to Claude Desktop

The orchestrator exposes HIGH-LEVEL tools that internally coordinate multiple MCPs:

```yaml
tools:
  # Main interaction tool
  - name: execute_task
    description: |
      Execute a task through the orchestrator. It will coordinate
      security scanning, use relevant tools, and remember the interaction.
    parameters:
      task:
        type: string
        description: What you want Annabelle to do
      context:
        type: string
        description: Optional additional context
    returns:
      result: string
      tools_used: array

  # Memory tools (implemented - same names as Memorizer MCP)
  - name: store_fact
    description: Store a discrete fact about the user
    parameters:
      fact:
        type: string
      category:
        type: string
        enum: [preference, background, pattern, project, contact, decision]
      agent_id:
        type: string
        default: main

  - name: list_facts
    description: List all stored facts
    parameters:
      agent_id:
        type: string
        default: main
      category:
        type: string
        required: false
      limit:
        type: integer
        default: 50

  - name: delete_fact
    description: Delete a specific fact by ID
    parameters:
      fact_id:
        type: integer

  - name: store_conversation
    description: Log a conversation turn (triggers fact extraction)
    parameters:
      user_message:
        type: string
      agent_response:
        type: string
      agent_id:
        type: string
        default: main

  - name: search_conversations
    description: Search conversation history
    parameters:
      query:
        type: string
      limit:
        type: integer
        default: 10

  - name: retrieve_memories
    description: Search for relevant facts and conversations
    parameters:
      query:
        type: string
      limit:
        type: integer
        default: 5
      include_conversations:
        type: boolean
        default: true

  - name: get_profile
    description: Get agent's user profile
    parameters:
      agent_id:
        type: string
        default: main

  - name: update_profile
    description: Update user profile fields
    parameters:
      updates:
        type: object
      agent_id:
        type: string
        default: main

  - name: get_memory_stats
    description: Get memory usage statistics
    parameters:
      agent_id:
        type: string
        default: main

  - name: export_memory
    description: Export memory to files
    parameters:
      format:
        type: string
        enum: [markdown, json]
        default: markdown

  - name: import_memory
    description: Import user-edited memory files
    parameters:
      file_path:
        type: string

  # Passthrough Tools (auto-discovered from downstream MCPs)
  # ============================================================
  # Tools are exposed with their ORIGINAL MCP names via ToolRouter.
  # If conflicts exist, they're prefixed with MCP name (e.g., telegram_send_message).
  # This allows direct passthrough to downstream MCPs.

  # Telegram MCP tools (passthrough)
  - name: send_message          # Send a message to a Telegram chat
  - name: list_chats            # List available Telegram chats
  - name: get_messages          # Get messages from a chat
  - name: get_chat              # Get chat details
  - name: subscribe_chat        # Manage subscriptions (action: subscribe/unsubscribe/list/clear)
  - name: get_new_messages      # Get new messages from queue
  - name: search_messages       # Search messages
  - name: mark_read             # Mark messages as read
  - name: get_me                # Get current user info

  # Filer MCP tools (passthrough)
  - name: create_file           # Create a file in workspace
  - name: read_file             # Read file contents
  - name: update_file           # Update existing file
  - name: delete_file           # Delete a file
  - name: list_files            # List directory contents
  - name: copy_file             # Copy a file
  - name: move_file             # Move/rename a file
  - name: search_files          # Search for files
  - name: get_workspace_info    # Get workspace information
  - name: get_audit_log         # Get file operation audit log
  - name: check_grant           # Check file access grant
  - name: request_grant         # Request file access
  - name: list_grants           # List active grants

  # Memory MCP tools (passthrough) - see above for full definitions
  # store_fact, list_facts, delete_fact, store_conversation,
  # search_conversations, get_profile, update_profile,
  # retrieve_memories, get_memory_stats, export_memory, import_memory

  # 1Password MCP tools (passthrough)
  # Uses original 1Password MCP tool names

  # Custom Orchestrator tools
  - name: get_status
    description: Get system status and available capabilities
    parameters: {}
```

### Tool Execution Flow

When Claude calls `execute_task`:

```
1. Claude Desktop calls: execute_task(task="Send schedule to Telegram")
                          ↓
2. Orchestrator MCP receives request
                          ↓
3. Core: Security scan via Guardian MCP
         └─→ If blocked: return error to Claude
                          ↓
4. Core: Get relevant memories via Memory MCP
         └─→ "User prefers morning briefings concise"
                          ↓
5. Core: Determine what tools needed
         └─→ Parse task, identify: telegram_send needed
                          ↓
6. Core: Execute tools via downstream MCPs
         └─→ Call Telegram MCP: send_message(...)
                          ↓
7. Core: Store interaction via Memory MCP
         └─→ Log conversation, extract facts
                          ↓
8. Core: Return result to Claude Desktop
         └─→ {result: "Sent to Telegram", tools_used: ["telegram"]}
```

### Client Configuration

The Orchestrator MCP works with Claude Desktop, Claude Code, AND LM Studio.

**Claude Desktop** - Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "annabelle": {
      "command": "python",
      "args": ["-m", "annabelle_orchestrator.mcp_server"],
      "env": {
        "GUARDIAN_MCP_URL": "http://localhost:8002",
        "ONEPASSWORD_MCP_URL": "http://localhost:8000",
        "TELEGRAM_MCP_URL": "http://localhost:8001",
        "MEMORY_MCP_URL": "http://localhost:8005"
      }
    }
  }
}
```

**LM Studio** - Add MCP server in LM Studio settings:

```json
{
  "mcpServers": {
    "annabelle": {
      "command": "python",
      "args": ["-m", "annabelle_orchestrator.mcp_server"],
      "env": {
        "GUARDIAN_MCP_URL": "http://localhost:8002",
        "ONEPASSWORD_MCP_URL": "http://localhost:8000",
        "TELEGRAM_MCP_URL": "http://localhost:8001",
        "MEMORY_MCP_URL": "http://localhost:8005"
      }
    }
  }
}
```

**Note:** The MCP server configuration is identical for both. The only difference is which application connects to it (Claude vs local model).

---

## Phase 2: REST API Interface (Future)

When you want a custom UI, add REST API alongside MCP:

```
┌─────────────────────────────────────────────────────────────────┐
│  ORCHESTRATOR SERVICE                                            │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    CORE LOGIC                            │    │
│  │            (same code as Phase 1)                        │    │
│  └─────────────────────────────────────────────────────────┘    │
│         ↑                                    ↑                   │
│         │                                    │                   │
│  ┌──────┴──────┐                     ┌──────┴──────┐            │
│  │ MCP Server  │                     │  REST API   │            │
│  │   :8010     │                     │   :8080     │            │
│  └─────────────┘                     └─────────────┘            │
│         ↑                                    ↑                   │
└─────────┼────────────────────────────────────┼──────────────────┘
          │                                    │
   Claude Desktop                        Custom Web UI
```

### REST API Endpoints (Phase 2)

```yaml
endpoints:
  # Chat endpoint (calls Claude API internally)
  POST /api/chat:
    body:
      session_id: string (optional)
      message: string
    response:
      session_id: string
      response: string
      tools_used: array

  # Memory endpoints
  GET /api/memory/profile:
    response: profile object

  POST /api/memory/fact:
    body:
      fact: string
      category: string

  GET /api/memory/search:
    query:
      q: string
      limit: integer

  # Direct tool execution
  POST /api/tools/telegram:
    body:
      message: string

  POST /api/tools/file:
    body:
      action: string
      path: string
      content: string

  # System
  GET /api/status:
    response: system status
```

### The Key Difference in Phase 2

In Phase 2, the REST API endpoint `/api/chat` will:
1. Receive user message
2. Build prompt (template + memory)
3. **Call AI API directly** (Claude OR LM Studio)
4. Parse response and execute tools
5. Return result

This gives you full control over the AI interaction, unlike Phase 1 where the client app (Claude Desktop/LM Studio) controls the AI.

### AI Model Configuration (Phase 2)

```yaml
ai_models:
  # Option 1: Claude API (cloud)
  claude:
    provider: anthropic
    model: claude-sonnet-4-20250514
    endpoint: https://api.anthropic.com/v1/messages
    api_key: ${ANTHROPIC_API_KEY}
    timeout: 60s
    max_tokens: 4096

  # Option 2: LM Studio (local)
  lm_studio:
    provider: openai_compatible    # LM Studio uses OpenAI-compatible API
    model: llama-3.1-8b            # or any model loaded in LM Studio
    endpoint: http://localhost:1234/v1/chat/completions
    api_key: not-needed
    timeout: 120s                  # local models may be slower
    max_tokens: 2048

  # Option 3: Ollama (local alternative)
  ollama:
    provider: openai_compatible
    model: llama3.1
    endpoint: http://localhost:11434/v1/chat/completions
    api_key: not-needed

  # Which to use
  default: lm_studio              # Primary model
  fallback: claude                # If primary fails/unavailable
```

### Model Selection Logic

```python
async def call_ai(prompt: str, config: AIConfig) -> AIResponse:
    """Call AI model with fallback support"""

    models_to_try = [config.default]
    if config.fallback:
        models_to_try.append(config.fallback)

    for model_name in models_to_try:
        model = config.models[model_name]
        try:
            if model.provider == "anthropic":
                return await call_anthropic(prompt, model)
            elif model.provider == "openai_compatible":
                return await call_openai_compatible(prompt, model)
        except Exception as e:
            log.warning(f"Model {model_name} failed: {e}")
            continue

    raise AIError("All models failed")
```

---

## Core Orchestration Components

These components are shared between MCP and REST interfaces:

### 1. Security Coordinator

```python
class SecurityCoordinator:
    """Coordinates security scanning via Guardian MCP"""

    async def scan_input(self, content: str) -> ScanResult:
        """Scan user input before processing"""
        result = await self.guardian_mcp.scan_input(content)
        if result.blocked:
            self.log_security_event(content, result)
        return result

    async def scan_output(self, content: str, tool: str) -> ScanResult:
        """Scan output before sensitive operations"""
        if tool in SENSITIVE_TOOLS:
            return await self.guardian_mcp.scan_output(content)
        return ScanResult(allowed=True)
```

### 2. Tool Router (Passthrough Routing)

```typescript
class ToolRouter {
    /**
     * Auto-discovers tools from all connected MCPs and routes calls to them.
     * Tools keep their original names unless conflicts exist.
     */

    private routes: Map<string, { mcp: BaseMCPClient; originalName: string }>;
    private mcpClients: Map<string, BaseMCPClient>;

    async discoverTools(): Promise<void> {
        // Phase 1: Collect all tools from all MCPs
        const allMcpTools = new Map<string, { mcp: string; tool: MCPToolDefinition }[]>();

        for (const [mcpName, client] of this.mcpClients) {
            const tools = await client.listTools();
            for (const tool of tools) {
                const existing = allMcpTools.get(tool.name) || [];
                existing.push({ mcp: mcpName, tool });
                allMcpTools.set(tool.name, existing);
            }
        }

        // Phase 2: Build routing table with conflict resolution
        for (const [toolName, sources] of allMcpTools) {
            if (sources.length === 1) {
                // No conflict - use original name
                this.routes.set(toolName, {
                    mcp: this.mcpClients.get(sources[0].mcp)!,
                    originalName: toolName
                });
            } else {
                // Conflict - prefix with MCP name
                for (const source of sources) {
                    const prefixedName = `${source.mcp}_${toolName}`;
                    this.routes.set(prefixedName, {
                        mcp: this.mcpClients.get(source.mcp)!,
                        originalName: toolName
                    });
                }
            }
        }
    }

    async routeToolCall(toolName: string, args: Record<string, unknown>): Promise<ToolCallResult> {
        const route = this.routes.get(toolName);
        if (!route) {
            return { success: false, error: `Unknown tool: ${toolName}` };
        }
        return route.mcp.callTool({ name: route.originalName, arguments: args });
    }
}
```

### 3. Memory Manager

```python
class MemoryManager:
    """Coordinates memory operations via Memory MCP"""

    async def get_context(self, query: str) -> MemoryContext:
        """Get relevant memories for a query"""
        memories = await self.memory_mcp.retrieve_memories(query, limit=5)
        profile = await self.memory_mcp.get_profile()
        return MemoryContext(memories=memories, profile=profile)

    async def store_interaction(self, user_msg: str, response: str):
        """Store conversation and extract facts"""
        await self.memory_mcp.store_conversation(user_msg, response)

    async def remember(self, fact: str, category: str):
        """Store explicit fact"""
        await self.memory_mcp.store_fact(fact, category)
```

### 4. Tool Executor

```python
class ToolExecutor:
    """Executes tools via downstream MCPs"""

    def __init__(self, mcp_registry: dict):
        self.mcps = mcp_registry  # {name: client}

    async def execute(self, tool: str, params: dict) -> ToolResult:
        """Execute a tool, handling security and errors"""

        # Find which MCP handles this tool
        mcp = self.find_mcp_for_tool(tool)

        # Security check for sensitive tools
        if tool in SENSITIVE_TOOLS:
            scan = await self.security.scan_output(str(params), tool)
            if scan.blocked:
                return ToolResult(error="Blocked by security")

        # Execute
        try:
            result = await mcp.call_tool(tool, params)
            return ToolResult(success=True, data=result)
        except Exception as e:
            return ToolResult(error=str(e))
```

### 5. Session Manager

```python
class SessionManager:
    """Manages conversation sessions"""

    def __init__(self):
        self.sessions = {}  # session_id -> SessionState

    def get_or_create(self, session_id: str = None) -> Session:
        """Get existing session or create new one"""
        if session_id and session_id in self.sessions:
            return self.sessions[session_id]

        new_session = Session(
            id=generate_id(),
            created_at=now(),
            history=[]
        )
        self.sessions[new_session.id] = new_session
        return new_session

    def add_turn(self, session_id: str, user_msg: str, response: str):
        """Add conversation turn to session"""
        session = self.sessions[session_id]
        session.history.append({
            "user": user_msg,
            "assistant": response,
            "timestamp": now()
        })
```

---

## MCP Server Implementation Structure

```
Orchestrator/
├── src/
│   ├── index.ts               # Entry point
│   ├── server.ts              # MCP server with passthrough routing
│   │
│   ├── core/
│   │   ├── orchestrator.ts    # Main orchestration logic
│   │   ├── tool-router.ts     # Passthrough tool routing & auto-discovery
│   │   ├── security.ts        # Security coordinator
│   │   ├── tools.ts           # Tool executor
│   │   └── sessions.ts        # Session manager
│   │
│   ├── mcp-clients/
│   │   ├── base.ts            # Base MCP client with listTools()
│   │   ├── guardian.ts        # Guardian MCP client
│   │   ├── onepassword.ts     # 1Password MCP client
│   │   ├── telegram.ts        # Telegram MCP client
│   │   ├── memory.ts          # Memory MCP client
│   │   └── filer.ts           # Filer MCP client
│   │
│   ├── config/
│   │   └── index.ts           # Configuration loading
│   │
│   └── utils/
│       └── errors.ts          # Error types
│
├── tests/
│   ├── integration/           # Integration tests (Vitest)
│   │   ├── telegram.test.ts
│   │   ├── filer.test.ts
│   │   ├── memory.test.ts
│   │   └── orchestrator.test.ts
│   └── helpers/
│       └── mcp-client.ts      # Test helper client
│
└── orchestrator.yaml          # Configuration
```

---

## Configuration

### Environment Variables

```bash
# Transport mode
TRANSPORT=http                    # "stdio" for Claude Desktop, "http" for Thinker
PORT=8010                         # HTTP port when TRANSPORT=http

# MCP connection mode
MCP_CONNECTION_MODE=stdio         # "stdio" spawns MCPs, "http" connects to running MCPs

# Security settings
SCAN_ALL_INPUTS=true
SECURITY_FAIL_MODE=closed         # "closed" blocks when scanner unavailable

# Logging
LOG_LEVEL=info
```

### MCP Server Configuration (stdio mode)

When `MCP_CONNECTION_MODE=stdio`, Orchestrator spawns these MCPs:

```yaml
# Configured in src/config/index.ts
mcp_servers:
  guardian:
    command: node
    args: [dist/Guardian/src/index.js]
    required: true

  telegram:
    command: node
    args: [dist/Telegram/src/index.js]
    required: false
    sensitive: true

  memory:
    command: node
    args: [dist/Memorizer/src/index.js]
    required: true

  filer:
    command: node
    args: [dist/Filer/src/index.js]
    required: false

  onepassword:
    command: node
    args: [dist/Onepassword/src/index.js]
    required: false
    sensitive: true
```

### Legacy HTTP Mode Configuration

When `MCP_CONNECTION_MODE=http` (backwards compatibility):

```bash
GUARDIAN_MCP_URL=http://localhost:8003
TELEGRAM_MCP_URL=http://localhost:8002
ONEPASSWORD_MCP_URL=http://localhost:8001
MEMORY_MCP_URL=http://localhost:8005
FILER_MCP_URL=http://localhost:8004
```

---

## Interaction Examples

### Example 1: Claude Desktop Usage

```
User (in Claude Desktop): "Hey, can you send my daily summary to Telegram?"

Claude (thinking): I'll use the orchestrator to handle this securely.

Claude calls tool: execute_task(
  task="Send daily summary to Telegram",
  context="User wants their daily summary"
)

Orchestrator:
  1. Security scan: OK
  2. Get memories: "User prefers concise summaries", "Last summary was yesterday"
  3. Execute: telegram_send(message="Daily Summary: ...")
  4. Store: Log this interaction
  5. Return: {result: "Sent summary to Telegram", tools_used: ["telegram"]}

Claude: "Done! I've sent your daily summary to Telegram."
```

### Example 2: Direct Memory Use

```
User: "Remember that I prefer morning standup at 9am"

Claude calls tool: store_fact(
  fact="Prefers morning standup at 9am",
  category="preference"
)

Orchestrator:
  1. Security scan: OK
  2. Store fact via Memory MCP
  3. Return: {stored: true}

Claude: "Got it, I'll remember you prefer 9am standups."
```

### Example 3: Credential Retrieval

```
User: "What's my GitHub token?"

Claude calls tool: get_credential(
  item_name="GitHub Token",
  vault="Development"
)

Orchestrator:
  1. Security scan input: OK
  2. Get from 1Password MCP
  3. Security scan output: Check for accidental exposure patterns
  4. Return: {found: true, note: "Token retrieved, use securely"}

Claude: "I found your GitHub token. For security, I won't display it
        directly, but it's available for any operations that need it."
```

---

## Migration Path: Phase 1 → Phase 2

### What Changes

| Aspect | Phase 1 (MCP) | Phase 2 (REST + MCP) |
|--------|---------------|---------------------|
| Entry point | MCP server only | MCP + REST API |
| AI model | Claude Desktop's model | Your Claude API calls |
| Prompt control | Limited | Full control |
| UI | Claude Desktop | Custom + Claude Desktop |
| Core logic | Same | Same |
| MCP clients | Same | Same |

### Migration Steps

1. **Keep MCP server running** (backward compatible)
2. **Add REST API interface** (new file, same core)
3. **Add prompt builder** (for REST API path)
4. **Add Claude API client** (for REST API path)
5. **Build custom UI** (connects to REST API)

### Code Change for Phase 2

```python
# interfaces/rest_api.py (NEW FILE)

from fastapi import FastAPI
from ..core.orchestrator import Orchestrator
from ..core.prompt_builder import PromptBuilder  # NEW
from ..core.claude_client import ClaudeClient    # NEW

app = FastAPI()
orchestrator = Orchestrator()
prompt_builder = PromptBuilder()
claude = ClaudeClient()

@app.post("/api/chat")
async def chat(request: ChatRequest):
    # Security scan
    scan = await orchestrator.security.scan_input(request.message)
    if scan.blocked:
        return {"error": "Blocked by security"}

    # Get memory context
    context = await orchestrator.memory.get_context(request.message)

    # Build prompt (NEW in Phase 2)
    prompt = prompt_builder.build(
        message=request.message,
        profile=context.profile,
        memories=context.memories,
        tools=orchestrator.get_available_tools()
    )

    # Call Claude API (NEW in Phase 2)
    response = await claude.generate(prompt)

    # Execute any tool calls
    if response.tool_calls:
        for tool_call in response.tool_calls:
            await orchestrator.tools.execute(tool_call)

    # Store conversation
    await orchestrator.memory.store_interaction(
        request.message,
        response.content
    )

    return {"response": response.content}
```

---

## Success Criteria

### Phase 1 (MCP Server + HTTP REST API) ✅ Complete

**Must work:**

- ✅ Claude Desktop can connect to orchestrator MCP via stdio
- ✅ Thinker can connect via HTTP REST API
- ✅ All 45+ tools callable from both interfaces
- ✅ Security scanning on inputs via Guardian
- ✅ Memory storage and retrieval
- ✅ Downstream MCP coordination via stdio
- ✅ Tool discovery via `/tools/list`
- ✅ Tool execution via `/tools/call`

### Phase 2 (Custom Web UI) - Future

**Must work:**

- Custom UI can call REST API
- Full prompt control
- Same core logic as Phase 1
- MCP server still works (backward compatible)

---

## Open Questions

### Phase 1

1. **Tool granularity:** Expose individual tools or just `execute_task`?
2. **Error handling:** How to communicate errors back to Claude Desktop?
3. **Streaming:** Support streaming responses in MCP?

### Phase 2

1. **Session persistence:** Store sessions in database or memory only?
2. **Authentication:** How to secure REST API?
3. **WebSocket:** Add real-time updates for long operations?
