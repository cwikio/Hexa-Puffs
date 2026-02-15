# Thinker MCP - Architecture Plan

## Overview

Thinker is a passive AI reasoning engine that receives messages from Orchestrator via HTTP and processes them using Groq (default) or local LLM (LM Studio/Ollama). It can trigger any tool across the MCP ecosystem via the Orchestrator's tool API.

**Key Decisions:**
- **Sidecar architecture** - runs alongside existing stack
- **Passive runtime** - receives messages via `POST /process-message` from Orchestrator
- Access tools **via Orchestrator using MCP SDK over HTTP**
- **Solid foundation** with proper abstractions
- **Env-based LLM switching** (Groq/LM Studio/Ollama)
- **Centralized tracing** with trace_id in Shared library
- **Persona stored in Memorizer** profiles
- **Embedding-based tool selection** - cosine similarity selects relevant tools per message, with regex fallback, persistent cache across restarts, and hot-reload when tools change
- **Sliding tools** - tools from recent turns auto-injected into follow-ups ("what about the other one?")
- **Post-conversation fact extraction** - idle timer triggers memory capture after user goes quiet
- **Hallucination guard** - detects action claims without tool calls, retries with forced tool use
- **Tool recovery** - detects tool calls leaked as text by LLMs and executes them
- **Playbook seeding** - 15 default playbooks seeded on first startup, with per-playbook required tool injection
- **Port 8006** for default agent; **port 0** for subagents (OS-assigned dynamic port)
- **Lazy-spawn** - Orchestrator registers agents at startup, spawns only on first message
- **Subagent support** - agents can spawn temporary Thinker subprocesses via `spawn_subagent`
- **TypeScript** consistent with other MCPs
- **Cost safeguards** - circuit breaker, rate limiting, reduced maxSteps (see Safety section)

**Tech Stack:**
- **Vercel AI SDK** (`ai`, `@ai-sdk/openai`) - ReAct agent with `maxSteps`, unified provider interface
- **Zod** - Schema validation (consistent with Vercel AI SDK tools)
- **Shared/Types** - `StandardResponse<T>`, error classes for all function returns
- **Future UI:** Next.js 15+, Tailwind CSS, shadcn/ui
- **No tests initially** - will add after implementation complete

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              THINKER                                     │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  LLM Abstraction Layer                                            │   │
│  │  ├─ interface LLMProvider { chat(), functionCall() }              │   │
│  │  ├─ GroqProvider (default, cloud)                                 │   │
│  │  ├─ LMStudioProvider (local, OpenAI-compatible)                   │   │
│  │  └─ OllamaProvider (local, flexible)                              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Message Source Abstraction                                       │   │
│  │  ├─ interface MessageSource { poll(), ack() }                     │   │
│  │  ├─ TelegramSource (polls via Orchestrator)                       │   │
│  │  └─ [Future: Discord, Slack, HTTP API]                            │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Tool Executor                                                    │   │
│  │  ├─ Discovers tools from Orchestrator on startup                  │   │
│  │  ├─ Executes via HTTP POST to Orchestrator                        │   │
│  │  └─ Handles tool results, errors, retries                         │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Context Manager                                                  │   │
│  │  ├─ Loads persona from Memory MCP profile                         │   │
│  │  ├─ Retrieves relevant facts for context                          │   │
│  │  ├─ Tracks conversation per chat_id                               │   │
│  │  └─ Builds system prompt dynamically                              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Agent Loop (ReAct-style)                                         │   │
│  │  ├─ Observe: Poll messages, get context                           │   │
│  │  ├─ Think: LLM reasoning with tools                               │   │
│  │  ├─ Act: Execute tool calls                                       │   │
│  │  ├─ Loop: Feed results back to LLM until done                     │   │
│  │  └─ Respond: Send via Telegram, store in Memory                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Trace Logger                                                     │   │
│  │  ├─ Creates trace_id for each request                             │   │
│  │  ├─ Logs all events to ~/.annabelle/logs/traces.jsonl             │   │
│  │  └─ Propagates trace_id to all MCP calls                          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTP
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                           ORCHESTRATOR (:8010)                           │
│  ├─ /tools - List all available tools                                   │
│  ├─ /execute - Execute a tool call                                      │
│  └─ Security scanning via Guardian                                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            ↓                       ↓                       ↓
    ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
    │  Telegram   │         │  Memorizer  │         │   Filer     │
    │   (:8002)   │         │   (:8005)   │         │  (:8004)    │
    └─────────────┘         └─────────────┘         └─────────────┘
```

---

## Dependencies

```json
{
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "zod": "^3.23.0",
    "express": "^4.21.0",
    "nanoid": "^5.0.0",
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0",
    "@types/express": "^4.17.0"
  }
}
```

**Note:** Link to `../Shared` for shared types via `npm link` or tsconfig paths.

---

## Configuration

### Environment Variables

```bash
# Master switch (mode flag - when true, Thinker handles Telegram; when false, Claude Desktop does)
THINKER_ENABLED=true

# LLM Provider (groq | lmstudio | ollama)
THINKER_LLM_PROVIDER=groq

# Groq (cloud, fast, cheap - DEFAULT)
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile

# LM Studio (local, free, private)
LMSTUDIO_BASE_URL=http://localhost:1234/v1
LMSTUDIO_MODEL=                          # Auto-detected if empty

# Ollama (local, flexible)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2

# Orchestrator connection (MCP SDK over HTTP)
ORCHESTRATOR_URL=http://localhost:8000

# Thinker HTTP server (for health checks)
THINKER_PORT=8006

# Polling (own setInterval, not Inngest)
TELEGRAM_POLL_INTERVAL_MS=30000          # 30 seconds (reduced from 10s for cost control)

# Agent
THINKER_AGENT_ID=thinker                 # Agent ID for Memory MCP profile

# Embedding-based tool selection
EMBEDDING_PROVIDER=ollama                # ollama | lmstudio (for tool embeddings)
OLLAMA_EMBEDDING_MODEL=nomic-embed-text  # Model for embeddings (Ollama)
LMSTUDIO_EMBEDDING_MODEL=               # Model for embeddings (LM Studio)
EMBEDDING_CACHE_DIR=~/.annabelle/data    # Directory for embedding cache file

# Logging
LOG_LEVEL=info
TRACE_LOG_PATH=~/.annabelle/logs/traces.jsonl
```

---

## Core Components

### 1. LLM Providers (Vercel AI SDK)

**Using Vercel AI SDK** (`ai` package) for unified provider interface with built-in ReAct support.

**Key packages:**
- `ai` - Core SDK with `generateText`, `tool()`, ReAct via `maxSteps`
- `@ai-sdk/openai` - OpenAI-compatible provider (works with Groq, LM Studio)
- `@ai-sdk/anthropic` - Optional, for Claude fallback

**Provider setup:**

```typescript
import { createOpenAI } from '@ai-sdk/openai';

// Groq (default) - OpenAI-compatible
const groq = createOpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY,
});

// LM Studio - OpenAI-compatible on localhost
const lmstudio = createOpenAI({
  baseURL: process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1',
  apiKey: 'lm-studio', // LM Studio ignores API key
});

// Ollama - OpenAI-compatible mode
const ollama = createOpenAI({
  baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  apiKey: 'ollama', // Ollama ignores API key
});
```

**Provider factory:**

```typescript
function getModel() {
  switch (process.env.THINKER_LLM_PROVIDER) {
    case 'groq': return groq(process.env.GROQ_MODEL || 'llama-3.3-70b-versatile');
    case 'lmstudio': return lmstudio(process.env.LMSTUDIO_MODEL || 'local-model');
    case 'ollama': return ollama(process.env.OLLAMA_MODEL || 'llama3.2');
    default: return groq('llama-3.3-70b-versatile');
  }
}
```

| Provider | Setup | Tool support |
|----------|-------|--------------|
| Groq | `@ai-sdk/openai` with Groq baseURL | Yes (function calling) |
| LM Studio | `@ai-sdk/openai` with localhost:1234 | Depends on model |
| Ollama | `@ai-sdk/openai` with localhost:11434/v1 | Yes (with supported models) |

### 2. Message Source

**Interface:**

```typescript
interface MessageSource {
  poll(): Promise<IncomingMessage[]>;
  ack(messageIds: string[]): Promise<void>;
  send(chatId: string, text: string, replyTo?: string): Promise<void>;
}
```

**TelegramSource:**
- Polls Orchestrator's `get_new_telegram_messages` tool
- Sends via `send_telegram` tool
- Filters by configured chat subscriptions

### 3. Tool Executor

**On startup:**
1. GET `{ORCHESTRATOR_URL}/tools` → list of all tools
2. Convert to LLM function definitions
3. Embed tool descriptions for semantic selection (cached to disk)
4. Cache for runtime use (hot-reloaded when tool set changes)

**On tool call:**
1. POST `{ORCHESTRATOR_URL}/execute` with tool name and params
2. Include `X-Trace-Id` header
3. Return result to LLM or handle error

### 4. Embedding-Based Tool Selection

Thinker uses **cosine similarity** over tool description embeddings to select the most relevant tools for each message. This replaces the original keyword-only approach with a semantic understanding of tool capabilities.

**How it works:**

1. On startup, all tool descriptions are embedded via the configured provider (Ollama or LM Studio)
2. Embeddings are cached to `~/.annabelle/data/embedding-cache.json` — subsequent startups skip re-embedding unchanged tools
3. Per message, the user text is embedded and compared against all tool embeddings via cosine similarity
4. Tools scoring above a dynamic threshold are selected, plus "core" always-included tools
5. If the embedding selector is unavailable, a regex-based fallback handles tool selection

**Hot-reload:** Before each message, the agent checks whether the Orchestrator's tool set has changed (via a 10-minute TTL cache). If tools were added or removed, the embedding index is incrementally updated — only new tools need embedding thanks to the persistent cache.

**Observability:** Tool selection logs include:
- Method used (embedding vs regex fallback)
- Number of tools selected vs total available
- Top score and cutoff threshold
- Debug-level: top 5 tool scores, regex overlap comparison

**Cache file format:**

The cache stores base64-encoded `Float32Array` embeddings keyed by `"toolName: description"`, with provider/model metadata for invalidation when the embedding model changes.

**Environment variables:**

| Variable | Default | Description |
|---|---|---|
| `EMBEDDING_PROVIDER` | `ollama` | Provider for tool embeddings (`ollama` or `lmstudio`) |
| `OLLAMA_EMBEDDING_MODEL` | `nomic-embed-text` | Ollama embedding model |
| `LMSTUDIO_EMBEDDING_MODEL` | (auto) | LM Studio embedding model |
| `EMBEDDING_CACHE_DIR` | `~/.annabelle/data` | Directory for cache file |

**Tool groups:** Keyword routes map message patterns to tool groups (search, email, calendar, files, passwords, browser, jobs, codexec). Each group has a regex pattern that triggers it.

### 4b. Sliding Tools (Sticky Tool Injection)

Follow-up messages like "what about the other one?" often reference tools from a recent turn that the embedding selector won't match for the new message. Sliding tools solve this by tracking non-core tools used in the last N turns and auto-injecting them.

**Configuration:**

| Variable | Default | Description |
|---|---|---|
| `THINKER_STICKY_TOOLS_LOOKBACK` | `3` | Number of recent turns to look back |
| `THINKER_STICKY_TOOLS_MAX` | `8` | Max sticky tools to inject |

Core tools (`send_telegram`, `store_fact`, `search_memories`, `get_status`, `spawn_subagent`) are exempt — they're always included anyway. Sticky tools are persisted across session restarts via the `recentToolsByTurn` field in session JSONL files.

### 4c. Post-Conversation Fact Extraction

After the user goes idle, Thinker automatically reviews recent conversation turns and extracts facts for long-term memory storage. This catches information that wasn't explicitly stored during the conversation.

**How it works:**

1. Each new message resets an idle timer
2. When the timer fires (user has been quiet), `runFactExtraction()` reviews the last N turns
3. Uses a cheap LLM model (compaction model) to minimize cost
4. Extracts facts with categories (preference, background, contact, project, decision, pattern)
5. Deduplicates against existing facts before storing
6. Only stores facts above the confidence threshold

**Configuration:**

| Variable | Default | Description |
|---|---|---|
| `factExtraction.enabled` | `false` | Enable post-conversation extraction |
| `factExtraction.idleMs` | `300000` | Idle timeout before extraction (ms) |
| `factExtraction.maxTurns` | `10` | Number of recent turns to review |
| `factExtraction.confidenceThreshold` | `0.7` | Minimum confidence for stored facts |

### 4d. Conversation Loop Resilience

**Tool Recovery:** Some LLMs (Groq/Llama) emit tool calls as text instead of structured JSON (e.g. "I'll call `memory_store_fact`..."). The agent detects these patterns and executes the recovered tool call.

**Hallucination Guard:** Detects when the model claims to have performed an action ("I've sent the email") but called no tools. Retries the turn with `toolChoice: 'required'` to force actual tool use.

**Temperature Modulation:** When the embedding selector has high confidence (>0.6), the LLM temperature is lowered to 0.3 for more reliable tool-calling behavior.

**Playbook Tool Injection:** Each playbook can declare `required_tools: string[]`. These tools are force-included in the tool set even if the embedding selector wouldn't match them, ensuring playbook actions always have access to the tools they need.

### 5. Context Manager

**Loads from Memory MCP:**
- Profile for `agent_id: "thinker"` (contains persona)
- Relevant facts based on user message
- Recent conversation history for this chat

**Builds system prompt:**

```
{persona.system_prompt}

User Profile:
{formatted_user_profile}

Relevant Memories:
{formatted_facts}

Recent Conversation:
{last_5_messages_in_this_chat}

Available Tools:
{tool_descriptions}
```

### 6. Agent Loop (Vercel AI SDK with maxSteps)

**No manual loop needed!** Vercel AI SDK handles ReAct automatically:

```typescript
import { generateText, tool } from 'ai';
import { z } from 'zod';
import { createSuccess, createError, StandardResponse } from '@shared/Types/StandardResponse';

async function processMessage(
  userMessage: string,
  chatId: string,
  context: Context
): Promise<StandardResponse<{ response: string; toolsUsed: string[] }>> {
  try {
    const result = await generateText({
      model: getModel(),
      system: context.systemPrompt,
      messages: [
        ...context.conversationHistory,
        { role: 'user', content: userMessage }
      ],
      tools: {
        send_telegram: tool({
          description: 'Send a message to Telegram',
          parameters: z.object({
            chat_id: z.string(),
            message: z.string(),
          }),
          execute: async ({ chat_id, message }) => {
            return orchestrator.callTool('send_telegram', { chat_id, message });
          },
        }),
        store_fact: tool({
          description: 'Store a fact in memory',
          parameters: z.object({
            fact: z.string(),
            category: z.enum(['preference', 'background', 'pattern', 'project', 'decision']),
          }),
          execute: async ({ fact, category }) => {
            return orchestrator.callTool('store_fact', { agent_id: 'thinker', fact, category });
          },
        }),
        // ... dynamically loaded tools from Orchestrator
      },
      maxSteps: 8,  // ReAct loop limit
    });

    // Send final response to Telegram
    await orchestrator.callTool('send_telegram', {
      chat_id: chatId,
      message: result.text,
    });

    // Store conversation in Memory
    await orchestrator.callTool('store_conversation', {
      agent_id: 'thinker',
      user_message: userMessage,
      agent_response: result.text,
    });

    const toolsUsed = result.steps
      .flatMap(step => step.toolCalls?.map(tc => tc.toolName) || []);

    return createSuccess({ response: result.text, toolsUsed });
  } catch (error) {
    return createError(error instanceof Error ? error.message : 'Unknown error');
  }
}
```

**How `maxSteps` works:**
1. LLM generates response (may include tool calls)
2. SDK executes tools automatically via `execute` functions
3. Results fed back to LLM as tool results
4. Loop continues until LLM returns text without tools OR maxSteps reached
5. Final `result.text` contains the response to send

### 7. Trace Logger (Shared Library)

**Lives in:** `Shared/Tracing/` - reusable across ALL MCPs

**Every request:**
1. Generate `trace_id: tr_{nanoid()}`
2. Log all events with trace_id
3. Pass trace_id in HTTP headers (`X-Trace-Id`) to all MCP calls

**Shared library interface:**

```typescript
// Shared/Tracing/context.ts
export interface TraceContext {
  traceId: string;
  startedAt: number;
}

export function createTrace(): TraceContext;
export function logTrace(ctx: TraceContext, mcp: string, event: string, data: object): void;
export function getTraceFromHeaders(headers: Record<string, string>): TraceContext | null;
```

**Log format (JSONL):**

```json
{"trace_id":"tr_abc123","ts":"2026-02-02T10:30:00.123Z","mcp":"thinker","event":"message_received","data":{"chat_id":"123","text":"Hello"}}
{"trace_id":"tr_abc123","ts":"2026-02-02T10:30:00.234Z","mcp":"thinker","event":"context_loaded","data":{"facts":5,"profile":true}}
{"trace_id":"tr_abc123","ts":"2026-02-02T10:30:01.456Z","mcp":"thinker","event":"llm_call","data":{"provider":"groq","model":"llama-3.3-70b","input_tokens":1200}}
{"trace_id":"tr_abc123","ts":"2026-02-02T10:30:02.789Z","mcp":"orchestrator","event":"tool_executed","data":{"tool":"send_telegram"}}
{"trace_id":"tr_abc123","ts":"2026-02-02T10:30:03.012Z","mcp":"thinker","event":"complete","data":{"duration_ms":2889}}
```

**All MCPs will be updated to:**
1. Accept `X-Trace-Id` header
2. Use Shared/Tracing for logging
3. Propagate trace_id to downstream calls

---

## Persona Configuration

Stored in Memory MCP as profile for `agent_id: "thinker"`:

```json
{
  "agent_id": "thinker",
  "profile_data": {
    "persona": {
      "name": "Annabelle",
      "style": "technical assistant",
      "tone": "direct, concise, no fluff",
      "system_prompt": "You are Annabelle, a technical AI assistant. You help the user accomplish tasks efficiently. Be direct and technical. Focus on getting things done. Don't be verbose or add unnecessary pleasantries. When you need to use tools, do so without asking for permission unless the action is destructive or irreversible."
    },
    "capabilities": {
      "can_send_telegram": true,
      "can_manage_files": true,
      "can_store_memories": true,
      "can_schedule_tasks": true
    },
    "proactive_behaviors": {
      "morning_summary": false,
      "task_reminders": false,
      "acknowledge_messages": true
    }
  }
}
```

**User can edit via:**
- `~/.annabelle/memory-export/profiles/thinker.md`
- Or directly via Memory MCP tools

---

## Proactive Behaviors (Inngest Integration)

### Current MVP: Reactive Only
- Thinker polls Telegram queue
- Processes messages as they arrive
- No unprompted actions

### Future: Proactive via Inngest

**Morning Summary Job:**

```typescript
inngest.createFunction(
  { id: "thinker-morning-summary" },
  { cron: "0 8 * * *" },  // 8am daily
  async () => {
    const tasks = await memoryMCP.search({ query: "task", category: "project" });
    const prompt = `Generate a morning summary for the user. Open tasks: ${tasks}`;
    const summary = await thinker.generate(prompt);
    await telegramMCP.send(userChatId, summary);
  }
);
```

**Task Reminder Job:**

```typescript
inngest.createFunction(
  { id: "thinker-task-reminders" },
  { cron: "0 18 * * *" },  // 6pm daily
  async () => {
    const deadlines = await memoryMCP.search({ query: "deadline" });
    // Filter for tomorrow's deadlines
    // Send reminder via Telegram
  }
);
```

---

## File Structure

### Thinker MCP

```
Thinker/
├── src/
│   ├── index.ts                 # Entry point, HTTP server, LISTENING_PORT= announcement
│   ├── config.ts                # Environment config loader (Zod), port 0 for subagents
│   │
│   ├── llm/
│   │   ├── types.ts             # LLMProvider interface
│   │   ├── providers.ts         # Provider implementations (Groq, LM Studio, Ollama)
│   │   ├── factory.ts           # Provider factory based on env
│   │   └── index.ts             # Barrel export
│   │
│   ├── orchestrator/
│   │   ├── client.ts            # HTTP client to Orchestrator
│   │   ├── tools.ts             # Tool discovery and execution
│   │   ├── types.ts             # Tool definitions
│   │   └── index.ts             # Barrel export
│   │
│   ├── cost/
│   │   ├── types.ts             # CostControlConfig, CostStatus, TokenBucket
│   │   ├── monitor.ts           # CostMonitor — sliding-window anomaly detection
│   │   └── index.ts             # Barrel export
│   │
│   ├── agent/
│   │   ├── loop.ts              # ReAct agent loop + DEFAULT_SYSTEM_PROMPT + hot-reload
│   │   ├── embedding-tool-selector.ts  # Embedding-based tool selection with cache persistence
│   │   ├── embedding-config.ts  # Embedding provider configuration (Ollama/LM Studio)
│   │   ├── tool-selection.ts    # selectToolsWithFallback() — embedding → regex fallback
│   │   ├── tool-selector.ts     # Regex-based tool group selection (fallback)
│   │   ├── skill-loader.ts      # Inngest skill loader (proactive tasks)
│   │   ├── fact-extractor.ts    # Extract facts from conversation for memory
│   │   ├── playbook-seed.ts     # 12 default playbooks seeded on first startup
│   │   ├── playbook-cache.ts    # In-memory playbook cache
│   │   ├── playbook-classifier.ts # Playbook keyword matching
│   │   ├── types.ts             # Agent state types
│   │   └── index.ts             # Barrel export (Agent class)
│   │
│   ├── session/
│   │   ├── store.ts             # Session file persistence (~/.annabelle/sessions/)
│   │   ├── types.ts             # Session types
│   │   └── index.ts             # Barrel export
│   │
│   ├── tracing/
│   │   ├── context.ts           # TraceContext, createTrace()
│   │   ├── logger.ts            # JSONL trace writer
│   │   ├── types.ts             # Trace types
│   │   └── index.ts             # Barrel export
│   │
│   └── utils/
│       ├── sanitize.ts          # Input sanitization utilities
│       └── recover-tool-call.ts # Recover tool calls leaked as text by LLM
│
├── package.json
├── tsconfig.json
├── .env.example
└── ARCHITECTURE.md
```

### Shared Library Addition

```
Shared/
├── ... (existing)
├── Tracing/
│   ├── index.ts                 # Exports
│   ├── context.ts               # TraceContext, createTrace(), getTraceFromHeaders()
│   ├── logger.ts                # logTrace() - JSONL writer
│   └── types.ts                 # Trace types
└── package.json                 # Update exports
```

---

## Message Flow

### Orchestrator → Thinker → Response

```
1. Orchestrator receives Telegram message (via ChannelPoller)
   └─→ MessageRouter resolves target agent
   └─→ ensureRunning() — lazy-spawns agent if stopped
   └─→ POST /process-message to Thinker

2. Thinker receives message:
   └─→ /health returns 503 until agentRef is set (init gate)
   └─→ Hot-reload check: refresh tools if Orchestrator tool set changed
   └─→ Create trace_id
   └─→ Select relevant tools (embedding cosine similarity → regex fallback)
   └─→ Load persona from session or persona file
   └─→ Retrieve relevant facts
   └─→ Build conversation context

3. LLM call (Groq default)
   └─→ System prompt + context + user message
   └─→ Available tools as functions (filtered by tool selector)
   └─→ Response: content and/or tool_calls
   └─→ If LLM leaks tool call as text → recover-tool-call.ts detects & executes

4. If tool_calls:
   └─→ Execute each via Orchestrator /tools/call
   └─→ If spawn_subagent: Orchestrator spawns temporary Thinker on dynamic port
   └─→ Collect results
   └─→ Feed back to LLM
   └─→ Repeat until final response (maxSteps: 8)

5. Return response to Orchestrator:
   └─→ Orchestrator sends via send_telegram
   └─→ Orchestrator stores conversation in Memory MCP
   └─→ Log trace complete

6. Idle scanner (every 5 min):
   └─→ Agents idle beyond idleTimeoutMinutes are stopped
   └─→ Re-spawned on next message (lazy-spawn)
```

---

## Implementation Phases

### Phase 1: Project Setup

- [ ] Initialize TypeScript project (package.json, tsconfig.json)
- [ ] Install dependencies: `ai`, `@ai-sdk/openai`, `zod`, `express`
- [ ] Config loader with Zod validation (env vars)
- [ ] Basic HTTP server on port 8006 (health check endpoint)
- [ ] Link to Shared library for types

### Phase 2: Vercel AI SDK Integration

- [ ] Provider factory (Groq, LM Studio, Ollama via `@ai-sdk/openai`)
- [ ] Basic `generateText` call with single provider
- [ ] Tool definition pattern using `tool()` from `ai`
- [ ] Test with simple hardcoded tool

### Phase 3: Shared Library - Tracing

- [ ] Add `Shared/Tracing/` module
- [ ] TraceContext interface and helpers
- [ ] JSONL logger to `~/.annabelle/logs/traces.jsonl`
- [ ] Header propagation utilities (`X-Trace-Id`)

### Phase 4: Orchestrator Client

- [ ] HTTP client to Orchestrator for tool discovery
- [ ] Dynamic tool loading from Orchestrator's tool list
- [ ] Convert Orchestrator tools to Vercel AI SDK `tool()` format
- [ ] Tool executor that calls Orchestrator

### Phase 5: Message Processing Loop

- [ ] Telegram polling via Orchestrator's `get_new_telegram_messages`
- [ ] setInterval-based polling (30 seconds)
- [ ] `generateText` with `maxSteps: 8` for ReAct
- [ ] Response sending via `send_telegram`
- [ ] Conversation storage in Memory MCP

### Phase 6: Context & Memory

- [ ] Load persona from Memory MCP profile (`agent_id: "thinker"`)
- [ ] Retrieve relevant facts for context
- [ ] Build dynamic system prompt
- [ ] Per-chat conversation history tracking

### Phase 7: Additional Providers

- [ ] Test LM Studio provider switching
- [ ] Test Ollama provider switching
- [ ] Fallback handling when provider unavailable

### Phase 8: Proactive Features (Future)

- [ ] Time-based triggers (Inngest cron)
- [ ] Event-based triggers (webhooks)
- [ ] Context-based triggers (Memory)
- [ ] Multi-turn conversation tracking

**Note:** Tests will be added after implementation is complete.

---

## Verification Plan

### TypeScript Check (Required after every phase)

```bash
cd Thinker && npx tsc --noEmit
cd Shared && npx tsc --noEmit
```

### Manual Testing Checklist

1. **Start existing MCPs:**

   ```bash
   ./start-all.sh
   ```

2. **Start Thinker:**

   ```bash
   cd Thinker && THINKER_ENABLED=true npm start
   ```

3. **Verify health:**

   ```bash
   curl http://localhost:8006/health
   ```

4. **Send Telegram message** to the bot/account

5. **Verify response** appears in Telegram within ~15 seconds

6. **Check trace log:**

   ```bash
   tail -f ~/.annabelle/logs/traces.jsonl
   ```

7. **Check Memory MCP** for stored conversation:

   ```bash
   curl http://localhost:8005/search_conversations -d '{"agent_id":"thinker","limit":1}'
   ```

### LLM Provider Testing

1. **Groq (default):** Set `THINKER_LLM_PROVIDER=groq`, verify response
2. **LM Studio:** Start LM Studio, set `THINKER_LLM_PROVIDER=lmstudio`, verify response
3. **Ollama:** Start Ollama, set `THINKER_LLM_PROVIDER=ollama`, verify response

**Note:** Automated tests will be added after implementation is complete.

---

## Resolved Decisions

| Question | Decision |
|----------|----------|
| Chat routing | Orchestrator's ChannelPoller + MessageRouter dispatch to agents |
| Message delivery | Passive — Thinker receives messages via POST /process-message |
| Orchestrator API | HTTP REST (/tools/list, /tools/call) |
| Port | 8006 (primary), 0 for subagents (OS-assigned dynamic port) |
| Language | TypeScript |
| Persona | Technical assistant (direct, concise) |
| Subagent model | Synchronous — tool call blocks until subagent returns |
| Agent lifecycle | Lazy-spawn on first message, idle-kill after inactivity |

---

## Safety & Cost Controls

The agent includes multiple layers of protection against runaway API costs:

### 1. Chat Auto-Discovery (Never Monitor Bot's Own Chat)

The bot auto-discovers private chats via `list_chats` and **always excludes its own Saved Messages** (`botUserId`). This prevents the fundamental feedback loop where the bot processes its own responses.

- If explicit subscriptions exist, those are used (with bot's own ID filtered out)
- Otherwise, `listChats()` discovers all private chats, excluding the bot itself
- Chat list refreshes every 5 minutes to pick up new conversations

### 2. Timestamp Filter (Only Recent Messages)

Messages older than 2 minutes are ignored. This prevents the bot from processing old chat history on restart, which was a major source of runaway costs.

### 3. Per-Cycle Message Cap

Max 3 messages processed per poll cycle. Even if many messages queue up, the bot won't process more than 3 at a time, bounding API usage per interval.

### 4. Circuit Breaker (Hardened)

Automatically stops processing after accumulated errors. The error counter **decrements** on success instead of fully resetting, so intermittent successes don't mask a pattern of failures.

```typescript
// On error:
this.consecutiveErrors++;
if (this.consecutiveErrors >= 5) {
  this.circuitBreakerTripped = true;
}

// On success (decrement, don't reset):
if (this.consecutiveErrors > 0) this.consecutiveErrors--;
```

**Behavior:** After 5 net errors (not easily reset by a single success), the agent stops until restarted.

### 5. Rate Limiting

Enforces 1-second minimum interval between API calls.

### 6. Bot Message Pattern Filtering

Skips messages matching known bot-generated patterns (error messages, apology phrases). This is a last-resort filter; the primary protection is chat auto-discovery (layer 1).

**Critical:** Error messages are NOT sent to chat to prevent the bot from processing its own error messages.

### 7. Reduced API Call Multipliers

| Setting | Before | After | Impact |
|---------|--------|-------|--------|
| `maxSteps` | 10 | 8 | Bounded API calls per message |
| Retries | 3 attempts | 0 | 3x fewer API calls on errors |
| Poll interval | 10s | 30s | 3x fewer polls per minute |
| Messages per cycle | unlimited | 3 | Bounded cost per interval |

### 8. LLM Cost Monitor (Anomaly Detection)

Beyond the static safeguards above, Thinker includes a runtime **CostMonitor** that detects abnormal token consumption using a sliding-window algorithm. When triggered, it pauses the agent, and Orchestrator sends a Telegram notification.

**Algorithm:**

- 60-bucket ring buffer (1 bucket per minute, 1 hour of history)
- After each `generateText()` call, records `promptTokens + completionTokens` into the current minute's bucket
- **Spike detection:** compares the short-window rate (last N minutes, default 2) against the baseline rate (rest of the hour, computed over active buckets only). If short-window rate > baseline × `spikeMultiplier` (default 3x), and baseline has enough data (`minimumBaselineTokens`), the agent pauses.
- **Hard cap:** if total tokens in the last 60 minutes exceed `hardCapTokensPerHour`, the agent pauses immediately regardless of pattern.

**Configuration** (via environment variables, passed from Orchestrator's `agents.json`):

| Variable | Default | Description |
|---|---|---|
| `THINKER_COST_CONTROL_ENABLED` | `false` | Enable cost monitoring |
| `THINKER_COST_SHORT_WINDOW_MINUTES` | `2` | Short window for spike detection |
| `THINKER_COST_SPIKE_MULTIPLIER` | `3.0` | Spike threshold multiplier |
| `THINKER_COST_HARD_CAP_PER_HOUR` | `500000` | Absolute token cap per hour |
| `THINKER_COST_MIN_BASELINE_TOKENS` | `1000` | Minimum baseline before spike detection activates |

**Endpoints:**

- `GET /cost-status` — Returns current cost monitor state (tokens used, rates, pause status)
- `POST /cost-resume` — Resume a cost-paused agent (`{ resetWindow: true }` to clear history)

**Behavior when triggered:**

1. Current request completes normally (pause takes effect on the next call)
2. `processMessage()` and `processProactiveTask()` return `{ paused: true }` immediately
3. Orchestrator detects `paused: true`, marks the agent paused, sends Telegram alert
4. Agent remains paused until resumed via `POST /cost-resume` or Orchestrator's `POST /agents/:id/resume`

**Source:** `Thinker/src/cost/monitor.ts`, `Thinker/src/cost/types.ts`
**Tests:** `Thinker/tests/cost-monitor.test.ts` (16 tests)

### 9. Worst-Case Cost Calculation

With all safeguards:

- Max 3 messages per cycle, max 8 steps each = 24 API calls per cycle
- 30s poll interval = 2 cycles/min = 12 API calls/min max
- Circuit breaker trips after 5 net errors
- Estimated max runaway cost before breaker trips: **~$0.05**

### Incident History

**2026-02-03:** Infinite feedback loop caused $100 in Groq API charges.

- **Root cause:** Bot processed its own error messages in Saved Messages
- **Token usage:** 66.7 million input tokens
- **Fix:** Added bot message pattern filtering, removed error sending to chat

**2026-02-05:** Second feedback loop incident, 153+ Groq API calls.

- **Root cause:** Bot monitored its own Saved Messages (fallback when no subscriptions), processed old error messages and its own responses in a loop. Circuit breaker was bypassed because it fully reset on any success.
- **Fix:** (1) Auto-discover chats via `list_chats`, always exclude bot's own ID. (2) Timestamp filter: only process messages from last 2 minutes. (3) Per-cycle cap: max 3 messages. (4) Hardened circuit breaker: decrement on success instead of full reset. (5) Reduced `maxSteps` from 3 to 2.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| LM Studio doesn't support function calling | Fallback to text-based tool selection |
| Groq rate limits | Queue messages, exponential backoff |
| Orchestrator unavailable | Retry with backoff, notify user |
| Runaway agent loop | Max iterations limit (3), circuit breaker, rate limiting |
| Infinite feedback loop | Bot message filtering, no error messages sent to chat |
| Conflicting with Claude Desktop | Clear separation via chat partitioning |

---

## Next Steps

1. ~~Approve this plan~~
2. Set up project structure
3. Implement Phase 1 (core foundation)
4. Test with simple Telegram echo
5. Add tool integration (Phase 2)
6. Iterate based on testing
